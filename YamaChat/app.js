// =========================================================
// 1. 初期設定 (YOUR_PROJECT_ID, YOUR_API_KEYを必ず置き換えてください)
// =========================================================
const firebaseConfig = {
    apiKey: "AIzaSyDjDgy_QanVzmgdUs9t86qfEsTeSTXJnaY", 
    authDomain: "nasuweb-467f9.firebaseapp.com",
    projectId: "nasuweb-467f9",
    storageBucket: "nasuweb-467f9.firebasestorage.app",
    messagingSenderId: "23088520786",
    appId: "1:23088520786:web:cef756e264b7f64214498b"
    // 他の必要な設定...
};

// アプリとサービスの初期化
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null; // 現在のログインユーザーを保持

// DOM要素の取得
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const signInButton = document.getElementById('signInButton');
const signUpButton = document.getElementById('signUpButton');
const signOutButton = document.getElementById('signOutButton');
const userInfo = document.getElementById('user-info');
const chatArea = document.getElementById('chat-area');
const callArea = document.getElementById('call-area');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startCallButton = document.getElementById('startCallButton');
const callStatus = document.getElementById('call-status');

// WebRTC関連のグローバル変数
let localStream = null;
let peerConnection = null;
// Googleの公開STUNサーバーを使用
const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};
// 注: 簡易化のため、ここでは固定の通話IDを使用しています。
const callId = 'DEMO_CALL_ROOM'; 

// =========================================================
// 2. メール/パスワード認証機能
// =========================================================

// ログイン処理
signInButton.addEventListener('click', () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    
    auth.signInWithEmailAndPassword(email, password)
        .catch((error) => {
            alert(`ログインエラー: ${error.message}`);
            console.error("ログインエラー:", error);
        });
});

// 新規登録処理
signUpButton.addEventListener('click', () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    
    auth.createUserWithEmailAndPassword(email, password)
        .then(() => {
            alert("新規登録が完了しました。自動でログインします。");
        })
        .catch((error) => {
            alert(`新規登録エラー: ${error.message}`);
            console.error("新規登録エラー:", error);
        });
});

// ログアウト処理
signOutButton.addEventListener('click', () => {
    auth.signOut();
});

// 認証状態の監視（ログイン/ログアウト時の画面切り替え）
auth.onAuthStateChanged((user) => {
    if (user) {
        // ログイン時
        currentUser = user;
        userInfo.textContent = `ようこそ、${user.email}さん (${user.uid})`;
        signInButton.style.display = 'none';
        signUpButton.style.display = 'none';
        signOutButton.style.display = 'inline';
        emailInput.style.display = 'none';
        passwordInput.style.display = 'none';
        chatArea.style.display = 'block';
        callArea.style.display = 'block';
        
        startChatListener();   // チャット監視開始
        getLocalStream();      // カメラ/マイクの準備開始
        answerCallListener();  // 着信（Answer）監視開始
    } else {
        // ログアウト時
        currentUser = null;
        userInfo.textContent = 'メールアドレスとパスワードでログインしてください。';
        signInButton.style.display = 'inline';
        signUpButton.style.display = 'inline';
        signOutButton.style.display = 'none';
        emailInput.style.display = 'inline';
        passwordInput.style.display = 'inline';
        chatArea.style.display = 'none';
        callArea.style.display = 'none';
    }
});


// =========================================================
// 3. リアルタイムチャット機能
// =========================================================

const messageInput = document.getElementById('messageInput');
const sendMessageButton = document.getElementById('sendMessageButton');
const messagesDiv = document.getElementById('messages');

// メッセージ送信処理
sendMessageButton.addEventListener('click', () => {
    const messageText = messageInput.value.trim();
    if (messageText && currentUser) {
        // ユーザー名としてメールアドレスの@以前の部分を使用
        const userName = currentUser.email.split('@')[0]; 
        
        db.collection("chats").add({
            uid: currentUser.uid,
            displayName: userName, 
            text: messageText,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        })
        .then(() => {
            messageInput.value = ''; // 入力欄をクリア
        })
        .catch((error) => console.error("メッセージ送信エラー:", error));
    }
});

// リアルタイムでメッセージを監視し、画面に表示
function startChatListener() {
    db.collection("chats")
      .orderBy("timestamp", "asc")
      .limit(50)
      .onSnapshot((snapshot) => {
        messagesDiv.innerHTML = ''; // メッセージリストをリセット
        snapshot.forEach((doc) => {
            const data = doc.data();
            const messageElement = document.createElement('p');
            // タイムスタンプを整形して表示
            const time = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleTimeString() : '...';
            messageElement.textContent = `[${time}] ${data.displayName}: ${data.text}`;
            messagesDiv.appendChild(messageElement);
        });
        // スクロールを一番下へ
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, (error) => {
        console.error("チャット監視エラー:", error);
    });
}

// =========================================================
// 4. WebRTCとシグナリング機能
// =========================================================

// ユーザーのカメラとマイクを取得
async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        callStatus.textContent = 'ステータス: カメラ/マイク準備OK';
        startCallButton.disabled = false; // 準備ができたらボタンを有効化
    } catch (e) {
        console.error('カメラ/マイクアクセス失敗:', e);
        callStatus.textContent = 'ステータス: カメラ/マイクアクセス失敗 (要許可)';
        startCallButton.disabled = true;
    }
}

/**
 * RTCPeerConnectionを初期化し、Offer/Answerの交換に必要なイベントリスナーを設定する
 */
function setupPeerConnection() {
    // 既存の接続があれば終了
    if (peerConnection) peerConnection.close();

    // ピア接続の初期化
    peerConnection = new RTCPeerConnection(configuration);
    
    // 自分のメディアストリームを接続に追加
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // リモートトラックの受信処理 (相手の映像が届いたら表示)
    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            callStatus.textContent = 'ステータス: 接続完了！通話中';
        }
    };
    
    const callDoc = db.collection('calls').doc(callId);

    // ICE Candidateのシグナリング (自分のIP情報をFirestoreに書き込む)
    peerConnection.onicecandidate = (event => {
        if (event.candidate) {
            callDoc.collection('candidates').add(event.candidate.toJSON());
        }
    });

    // 相手からのICE Candidateの待ち受け (Offer側/Answer側の両方で機能)
    callDoc.collection('candidates').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                try {
                    // リモート記述が設定されていることを確認してから追加
                    if (peerConnection && peerConnection.remoteDescription) { 
                        await peerConnection.addIceCandidate(candidate);
                    } else {
                        // ログ出力。エラーではなく、正常にスキップされたことを示します。
                        console.warn("リモート記述設定前なのでCandidateの追加をスキップしました。");
                    }
                } catch (e) {
                    console.error('ICE Candidate追加失敗:', e);
                }
            }
        });
    });
}

// 通話開始ボタンの処理（Offerの作成側）
startCallButton.addEventListener('click', async () => {
    if (!localStream) {
        alert("カメラとマイクの準備ができていません。");
        return;
    }
    
    // PeerConnectionの初期設定とイベントリスナーの設定
    setupPeerConnection();
    
    const callDoc = db.collection('calls').doc(callId);
    callStatus.textContent = 'ステータス: Offer作成中...';

    // 1. Offer (発信) の作成
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // OfferをFirestoreに書き込み
    await callDoc.set({ 
        offer: { type: offer.type, sdp: offer.sdp },
        // Answerが残っている可能性を考慮し、クリアしておく
        answer: null 
    });
    
    // 2. Answerの待ち受け (相手からの応答を監視)
    const unsubscribeAnswer = callDoc.onSnapshot(async (snapshot) => {
        const data = snapshot.data();
        if (data && data.answer && peerConnection && !peerConnection.currentRemoteDescription) {
            // 相手からAnswerが届いたら設定
            const answerDescription = new RTCSessionDescription(data.answer);
            await peerConnection.setRemoteDescription(answerDescription);
            
            // 接続に成功したらAnswer監視を停止
            unsubscribeAnswer(); 
            callStatus.textContent = 'ステータス: Answer受信、接続中...';
        }
    });
    
    startCallButton.textContent = '通話開始済み (相手を待機中)';
    startCallButton.disabled = true;
});


/**
 * 相手のOfferを監視し、Offerを受信したらAnswerを生成して応答する処理
 * これは、通話の着信側として機能します。
 */
async function answerCallListener() {
    const callDoc = db.collection('calls').doc(callId);
    
    // Offer/Answerを監視するリスナー
    callDoc.onSnapshot(async (snapshot) => {
        const data = snapshot.data();
        
        // Offerがあり、Answerがなく、かつ自分がログインしている場合（着信条件）
        if (data && data.offer && !data.answer && currentUser) {
            
            callStatus.textContent = 'ステータス: 相手からの着信を検出しました...';
            
            // 接続に必要なローカルストリーム（カメラ/マイク）を取得
            if (!localStream) await getLocalStream();
            if (!localStream) return;
            
            // PeerConnectionの初期設定とイベントリスナーの設定
            setupPeerConnection();

            // 2. Offerを受信したので、リモート記述として設定
            const offerDescription = new RTCSessionDescription(data.offer);
            await peerConnection.setRemoteDescription(offerDescription);
            
            // 3. Answerの作成と送信 (応答)
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            // AnswerをFirestoreに書き込み
            await callDoc.update({
                answer: { type: answer.type, sdp: answer.sdp }
            });

            callStatus.textContent = 'ステータス: Answerを送信しました。接続待機中...';
            document.getElementById('startCallButton').disabled = true;
        }
    });
}
