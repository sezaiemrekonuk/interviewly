const input = document.getElementById('origin');
const DEFAULT_ORIGIN = 'http://localhost';

chrome.storage.sync.get('interviewlyOrigin').then(({ interviewlyOrigin }) => {
  input.value = interviewlyOrigin || DEFAULT_ORIGIN;
});

document.getElementById('save').addEventListener('click', () => {
  const origin = input.value.trim().replace(/\/$/, '') || DEFAULT_ORIGIN;
  chrome.storage.sync.set({ interviewlyOrigin: origin });
});
