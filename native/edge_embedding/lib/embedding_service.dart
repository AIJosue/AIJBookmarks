import 'dart:math';
import 'package:flutter_edge_ai/flutter_edge_ai.dart';
import 'package:flutter_edge_ai_llama/flutter_edge_ai_llama.dart';

/// Singleton service implementing Google's recommended EmbeddingGemma-2 on-device embeddings
/// via flutter_edge_ai with GGUF llama backend (flutter_edge_ai_llama).
class EmbeddingService {
  EmbeddingService._internal();
  static final EmbeddingService instance = EmbeddingService._internal();

  static const String modelUrl =
      'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q4_K_XL.gguf';

  EmbeddingModel? _model;
  bool _initialized = false;

  /// Initializes FlutterEdgeAi with LlamaEmbeddingBackend.
  Future<void> init() async {
    if (_initialized) return;
    FlutterEdgeAi.init(backend: LlamaEmbeddingBackend());
    _initialized = true;
  }

  /// Installs, caches and loads the universal Unsloth EmbeddingGemma-2 GGUF model.
  /// Uses PreferredBackend.gpu with graceful CPU fallback.
  Future<void> loadModel({void Function(double progress)? onProgress}) async {
    await init();

    final installStream = FlutterEdgeAi.installEmbeddingModel().fromNetwork(
      Uri.parse(modelUrl),
      modelName: 'embeddinggemma-2-UD-Q4_K_XL.gguf',
    );

    await for (final progress in installStream) {
      onProgress?.call(progress.fractionCompleted);
      if (progress.isCompleted) break;
    }

    try {
      _model = await FlutterEdgeAi.loadEmbeddingModel(
        'embeddinggemma-2-UD-Q4_K_XL.gguf',
        preferredBackend: PreferredBackend.gpu,
      );
    } catch (_) {
      // Fallback to CPU if GPU initialization fails or is unsupported
      _model = await FlutterEdgeAi.loadEmbeddingModel(
        'embeddinggemma-2-UD-Q4_K_XL.gguf',
        preferredBackend: PreferredBackend.cpu,
      );
    }
  }

  /// Embeds query string using TaskType.retrievalQuery (Google Gemma recommendation).
  Future<List<double>> embedQuery(String query, {bool truncateTo256 = false}) async {
    final model = _ensureModel();
    final embedding = await model.embed(
      query,
      taskType: TaskType.retrievalQuery,
    );
    return truncateTo256 ? truncateMatryoshka(embedding, 256) : embedding;
  }

  /// Embeds document string using TaskType.retrievalDocument.
  /// Formats with optional document title prefix per Google Gemma guidelines.
  Future<List<double>> embedDocument(
    String text, {
    String? title,
    bool truncateTo256 = false,
  }) async {
    final model = _ensureModel();
    final content = (title != null && title.trim().isNotEmpty) ? '$title\n$text' : text;
    final embedding = await model.embed(
      content,
      taskType: TaskType.retrievalDocument,
    );
    return truncateTo256 ? truncateMatryoshka(embedding, 256) : embedding;
  }

  /// Exact cosine similarity between two dense vectors (-1.0 to 1.0).
  double cosineSimilarity(List<double> a, List<double> b) {
    if (a.isEmpty || b.isEmpty || a.length != b.length) return 0.0;
    double dot = 0.0;
    double normA = 0.0;
    double normB = 0.0;
    for (int i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA <= 1e-9 || normB <= 1e-9) return 0.0;
    return dot / (sqrt(normA) * sqrt(normB));
  }

  /// Optional Matryoshka dimension truncation (e.g. 768 to 256 dimensions)
  /// with L2 re-normalization.
  List<double> truncateMatryoshka(List<double> vector, int targetDims) {
    if (vector.length <= targetDims) return vector;
    final truncated = vector.sublist(0, targetDims);
    double sumSq = 0.0;
    for (final v in truncated) {
      sumSq += v * v;
    }
    final norm = sqrt(sumSq);
    if (norm <= 1e-9) return truncated;
    return truncated.map((v) => v / norm).toList();
  }

  EmbeddingModel _ensureModel() {
    final model = _model;
    if (model == null) {
      throw StateError('EmbeddingModel not loaded. Call loadModel() first.');
    }
    return model;
  }
}
