document.querySelector('h1').style.backgroundColor = 'skyblue';
document.getElementById('fcopy').innerHTML = '<small>&copy;&#32;chinodigital</small>';

// 画像ビューア表示
const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewer-img");

document.querySelectorAll(".thumb").forEach(img => {
  img.onclick = () => {
    viewerImg.src = img.src;
    viewer.showModal();
  };
});

// 画像ビューア閉じる
viewer.onclick = () => viewer.close();
