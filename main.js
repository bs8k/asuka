document.querySelectorAll('p').forEach(p => {
  if (p.textContent.trim() === '管理者') {
    p.textContent = '&copy; bs8k';
  }
});
