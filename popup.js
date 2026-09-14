// Extension pages forbid inline script, so the version is filled in here
// rather than hard-coded in popup.html, where it would drift from the manifest.
document.getElementById('version').textContent = chrome.runtime.getManifest().version;
