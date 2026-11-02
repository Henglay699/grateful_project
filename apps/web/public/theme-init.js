// Apply the saved theme before first paint (external file so the CSP can forbid inline scripts).
try {
  if (localStorage.getItem('gs:theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
} catch (e) {
  /* storage blocked */
}
