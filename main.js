document.querySelector('h1').style.backgroundColor = 'blue';
document.querySelectorAll('p').forEach(p => {
  if (p.textContent.trim() === '管理者') {
    p.innerHTML = '<small id="fcopy">&copy;&#32;&#99;&#104;&#105;&#110;&#111;&#100;</small>';
  }
});
