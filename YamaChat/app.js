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

// STUNサーバーと、ファイアウォールを迂回するための無料公開TURNサーバーを設定
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // STUNサーバー
        {
            urls: 'turn:openrelay.metered.ca:80', // 無料の公開TURNサーバー
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

const callId = 'DEMO_CALL_ROOM'; 

// =========================================================
// 2. メール/パスワード認証機能
// =========================================================

// ログイン処理
signInButton.addEventListener('click', () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    auth.signInWithEmailAndPassword(email, password)
        .catch((error) => { alert(`ログインエラー: ${error.message}`); });
});

// 新規登録処理
signUpButton.addEventListener('click', () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    auth.createUserWithEmailAndPassword(email, password)
        .then(() => { alert("新規登録完了。自動ログインします。"); })
        .catch((error) => { alert(`新規登録エラー: ${error.message}`); });
});

// ログアウト処理
signOutButton.addEventListener('click', () => {
    auth.signOut();
});

// 認証状態の監視
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        userInfo.textContent = `Login: ${user.email}`;
        signInButton.style.display = 'none';
        signUpButton.style.display = 'none';
        signOutButton.style.display = 'inline';
        emailInput.style.display = 'none';
        passwordInput.style.display = 'none';
        chatArea.style.display = 'block';
        callArea.style.display = 'block';
        
        startChatListener();   
        getLocalStream();      
        answerCallListener();  
    } else {
        currentUser = null;
        userInfo.textContent = 'ログインしてください';
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

sendMessageButton.addEventListener('click', () => {
    const messageText = messageInput.value.trim();
    if (messageText && currentUser) {
        db.collection("chats").add({
            uid: currentUser.uid,
            displayName: currentUser.email.split('@')[0], 
            text: messageText,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => { messageInput.value = ''; });
    }
});

function startChatListener() {
    db.collection("chats").orderBy("timestamp", "asc").limit(50)
      .onSnapshot((snapshot) => {
        messagesDiv.innerHTML = '';
        snapshot.forEach((doc) => {
            const data = doc.data();
            const p = document.createElement('p');
            p.textContent = `${data.displayName}: ${data.text}`;
            messagesDiv.appendChild(p);
        });
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}

// =========================================================
// 4. WebRTCとシグナリング機能 (修正版)
// =========================================================

async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        callStatus.textContent = 'ステータス: 準備OK';
        startCallButton.disabled = false;
        return true;
    } catch (e) {
        console.error('カメラエラー:', e);
        callStatus.textContent = 'ステータス: カメラエラー';
        return false;
    }
}

// PeerConnectionのセットアップ
function setupPeerConnection() {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(configuration);
    
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };
    
    // 接続状態の監視
    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log(`ICE State: ${state}`);
        callStatus.textContent = `ステータス: ${state}`;
        if (state === 'failed') alert("接続失敗: ネットワーク制限の可能性があります");
    };

    const callDoc = db.collection('calls').doc(callId);

    // 自分のCandidateを送信
    peerConnection.onicecandidate = (event => {
        if (event.candidate) {
            callDoc.collection('candidates').add(event.candidate.toJSON());
        }
    });

    // 相手のCandidateを受信
    callDoc.collection('candidates').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                if (peerConnection && peerConnection.remoteDescription) { 
                    try {
                        await peerConnection.addIceCandidate(candidate);
                        console.log("Candidate追加成功");
                    } catch (e) { console.error("Candidate追加エラー", e); }
                }
            }
        });
    });
}

// 発信処理 (Offer作成)
startCallButton.addEventListener('click', async () => {
    if (!localStream && !await getLocalStream()) return;
    
    setupPeerConnection();
    const callDoc = db.collection('calls').doc(callId);
    
    // 既存のデータをクリア（重要）
    const candidates = await callDoc.collection('candidates').get();
    candidates.forEach(doc => doc.ref.delete());
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Offer送信（作成者のIDを含めることで、自分が自分のOfferに応答するのを防ぐ）
    await callDoc.set({ 
        offer: { type: offer.type, sdp: offer.sdp },
        offerCreatorUid: currentUser.uid, // <--- これが重要！
        answer: null 
    });
    
    callStatus.textContent = '発信中...';
    startCallButton.disabled = true;

    // Answer待ち受け
    const unsubscribe = callDoc.onSnapshot(async (snapshot) => {
        const data = snapshot.data();
        if (data && data.answer && !peerConnection.currentRemoteDescription) {
            const answerDesc = new RTCSessionDescription(data.answer);
            await peerConnection.setRemoteDescription(answerDesc);
            unsubscribe(); 
            callStatus.textContent = '接続中...';
        }
    });
});

// 着信処理 (Answer作成)
function answerCallListener() {
    const callDoc = db.collection('calls').doc(callId);
    
    callDoc.onSnapshot(async (snapshot) => {
        const data = snapshot.data();
        // Offerがあり、Answerがなく、かつ「自分が作ったOfferではない」場合
        if (data && data.offer && !data.answer && currentUser && data.offerCreatorUid !== currentUser.uid) {
            
            console.log("着信を検知しました");
            if (!localStream && !await getLocalStream()) return;
            
            setupPeerConnection();

            // Offer設定
            const offerDesc = new RTCSessionDescription(data.offer);
            await peerConnection.setRemoteDescription(offerDesc);
            
            // Answer作成
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            // Answer送信
            await callDoc.update({
                answer: { type: answer.type, sdp: answer.sdp }
            });
            
            callStatus.textContent = '応答しました。接続中...';
            startCallButton.disabled = true;
        }
    });
}
