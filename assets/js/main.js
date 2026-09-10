// ヘッダー
document.querySelector('h1').style.backgroundColor = 'tomato';

// 画像ビューア表示
const viewer = document.getElementById('viewer');
const viewerImg = document.getElementById('viewer-img');

document.querySelectorAll('p img').forEach(img => {
  img.onclick = () => {
    viewerImg.src = img.src;
    viewer.showModal();
  };
});

// 画像ビューア閉じる
viewer.onclick = () => viewer.close();

// フッター
document.body.insertAdjacentHTML('beforeend', '<p id="fcopy"><small>&copy;&#32;chinodigital</small></p>');
