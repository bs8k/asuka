document.querySelector('h1').style.backgroundColor = 'blue';
document.querySelectorAll('p').forEach(p => {
  if (p.textContent.trim() === '管理者') {
    p.innerHTML = '&lt;&#115;&#109;&#97;&#108;&#108;&gt;&copy;&#32;&#99;&#104;&#105;&#110;&#111;&#100;&lt;&#47;&#115;&#109;&#97;&#108;&#108;&gt;';
  }
});
