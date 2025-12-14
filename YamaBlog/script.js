// 記事のダミーデータ
const blogPosts = [
    {
        id: 1,
        title: "YamaBlogV2を作成しました！",
        date: "2025-12-14",
        summary: "V1はもうすぐ公開終了いたしますのでご注意ください。",
        content: "これからもよろしくお願いします(^_^)"
    },
    
];

const postsListContainer = document.getElementById('posts-list');

// 記事一覧を表示する関数
function renderPostList() {
    postsListContainer.innerHTML = ''; // 一度内容をクリア

    blogPosts.forEach(post => {
        const postCard = document.createElement('article');
        postCard.className = 'post-card';
        
        postCard.innerHTML = `
            <h3><a href="#" onclick="showPostDetail(${post.id}); return false;">${post.title}</a></h3>
            <span class="date">${post.date}</span>
            <p>${post.summary}</p>
        `;
        postsListContainer.appendChild(postCard);
    });
}

// 記事詳細を表示する関数 (シミュレーション)
function showPostDetail(postId) {
    const post = blogPosts.find(p => p.id === postId);

    if (post) {
        postsListContainer.innerHTML = ''; // 記事一覧を非表示
        
        const detailView = document.createElement('div');
        detailView.className = 'post-detail';
        detailView.innerHTML = `
            <h2>${post.title}</h2>
            <p class="date">公開日: ${post.date}</p>
            <div class="post-content">
                <p>${post.content}</p>
                <p>---</p>
                <p>記事の終わりです。読んでくれてありがとうございました！</p>
            </div>
            <button onclick="window.location.reload();">記事一覧に戻る</button>
        `;
        
        postsListContainer.appendChild(detailView);
        // タイトルも詳細に合わせて変更
        document.title = `${post.title} | 私のブログ`; 
    }
}

// ページ読み込み時に実行
document.addEventListener('DOMContentLoaded', renderPostList);