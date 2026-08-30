import fs from 'fs';

let js = fs.readFileSync('options.js', 'utf8');

const helper = `
function ensureSelectHasValue(selectId, value) {
  const select = document.getElementById(selectId);
  if (select && value) {
    const hasOption = Array.from(select.options).some(opt => opt.value === value);
    if (hasOption) {
      select.value = value;
    } else {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      opt.selected = true;
      select.insertBefore(opt, select.firstChild);
    }
  }
}
`;

js = js.replace('async function loadSettings() {', helper + '\nasync function loadSettings() {');

const calls = `
    ensureSelectHasValue('geminiModel', settings.geminiModel || 'gemini-3.6-flash');
    ensureSelectHasValue('googleCloudModel', settings.googleCloudModel || 'gemini-2.5-flash');
`;

js = js.replace('const modelContextVal = snapToNearestBinaryContext', calls + '\n    const modelContextVal = snapToNearestBinaryContext');

fs.writeFileSync('options.js', js);
