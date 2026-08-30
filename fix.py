with open("options.js", "r") as f:
    js = f.read()

import re

# Remove the manual select value assignments for Gemini
js = re.sub(
    r"const geminiModel =.*?document\.getElementById\('googleCloudModel'\)\.value = settings\.googleCloudModel \|\| 'gemini-2\.5-flash';",
    "document.getElementById('googleCloudApiKey').value = settings.googleCloudApiKey || '';",
    js,
    flags=re.DOTALL
)

with open("options.js", "w") as f:
    f.write(js)
