import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import '../lib/embedding_service.dart';

/// Chrome / Firefox WebExtension Native Messaging Host
/// Standard stdio message protocol: 32-bit uint length prefix in native byte order.
void main() async {
  final service = EmbeddingService.instance;

  while (true) {
    final lengthBytes = stdin.readSync(4);
    if (lengthBytes.length < 4) break;

    final byteData = ByteData.sublistView(Uint8List.fromList(lengthBytes));
    final msgLength = byteData.getUint32(0, Endian.host);

    final payloadBytes = stdin.readSync(msgLength);
    if (payloadBytes.length < msgLength) break;

    final jsonStr = utf8.decode(payloadBytes);
    final request = jsonDecode(jsonStr) as Map<String, dynamic>;

    final response = await _handleRequest(service, request);
    final responseBytes = utf8.encode(jsonEncode(response));

    final header = ByteData(4)..setUint32(0, responseBytes.length, Endian.host);
    stdout.add(header.buffer.asUint8List());
    stdout.add(responseBytes);
    await stdout.flush();
  }
}

Future<Map<String, dynamic>> _handleRequest(
  EmbeddingService service,
  Map<String, dynamic> request,
) async {
  final action = request['action'] as String?;

  try {
    switch (action) {
      case 'ping':
        return {'success': true, 'pong': true, 'provider': 'llama_dart_edge'};

      case 'loadModel':
        await service.loadModel();
        return {'success': true, 'status': 'loaded'};

      case 'embedQuery':
        final query = request['query'] as String? ?? '';
        final truncate = request['truncateTo256'] as bool? ?? false;
        final vector = await service.embedQuery(query, truncateTo256: truncate);
        return {'success': true, 'vector': vector, 'dimensions': vector.length};

      case 'embedDocument':
        final text = request['text'] as String? ?? '';
        final title = request['title'] as String?;
        final truncate = request['truncateTo256'] as bool? ?? false;
        final vector = await service.embedDocument(text, title: title, truncateTo256: truncate);
        return {'success': true, 'vector': vector, 'dimensions': vector.length};

      case 'cosineSimilarity':
        final vecA = (request['vecA'] as List).map((e) => (e as num).toDouble()).toList();
        final vecB = (request['vecB'] as List).map((e) => (e as num).toDouble()).toList();
        final sim = service.cosineSimilarity(vecA, vecB);
        return {'success': true, 'similarity': sim};

      default:
        return {'success': false, 'error': 'Unknown action: $action'};
    }
  } catch (e) {
    return {'success': false, 'error': e.toString()};
  }
}
