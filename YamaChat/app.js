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

const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentCallId = null; 
let localStream = null;
let peerConnection = null;
let currentFacingMode = 'user'; 

// TURNサーバー設定
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// =========================================================
// 2. DOM要素とイベントリスナーの初期化 (HTML読み込み後実行)
// =========================================================
let authStatusDiv, appContainer, loadingSpinner, usersContainer, 
    signInButton, signUpButton, signOutButton, 
    sendMessageButton, switchCameraButton, hangupButton, 
    answerButton, rejectButton,
    localVideo, remoteVideo, callOverlay, callStatus, incomingModal; // 全要素を変数として宣言

window.onload = function() {
    // DOM要素の取得
    authStatusDiv = document.getElementById('auth-status');
    appContainer = document.getElementById('app-container');
    loadingSpinner = document.getElementById('loading-spinner');
    usersContainer = document.getElementById('users-container');

    signInButton = document.getElementById('signInButton');
    signUpButton = document.getElementById('signUpButton');
    signOutButton = document.getElementById('signOutButton');
    sendMessageButton = document.getElementById('sendMessageButton');
    switchCameraButton = document.getElementById('switchCameraButton');
    hangupButton = document.getElementById('hangupButton');
    answerButton = document.getElementById('answerButton');
    rejectButton = document.getElementById('rejectButton');
    
    localVideo = document.getElementById('localVideo');
    remoteVideo = document.getElementById('remoteVideo');
    callOverlay = document.getElementById('call-overlay');
    callStatus = document.getElementById('call-status');
    incomingModal = document.getElementById('incoming-call-modal');


    // UIイベントリスナーの設定
    signInButton.addEventListener('click', () => {
        const email = document.getElementById('emailInput').value;
        const password = document.getElementById('passwordInput').value;
        auth.signInWithEmailAndPassword(email, password).catch(e => alert(e.message));
    });

    signUpButton.addEventListener('click', () => {
        const email = document.getElementById('emailInput').value;
        const password = document.getElementById('passwordInput').value;
        auth.createUserWithEmailAndPassword(email, password).catch(e => alert(e.message));
    });

    signOutButton.addEventListener('click', () => {
        if (currentUser) {
            db.collection('users').doc(currentUser.uid).delete().catch(console.error);
        }
        auth.signOut();
    });

    sendMessageButton.addEventListener('click', sendMessage);
    switchCameraButton.addEventListener('click', switchCamera); // カメラ切り替え
    hangupButton.addEventListener('click', endCall); // 通話終了
    answerButton.addEventListener('click', answerCall); // 応答
    rejectButton.addEventListener('click', rejectCall); // 拒否

    // Firebase認証状態の監視を開始
    startAuthListener();
}


// =========================================================
// 3. 認証 & ユーザー管理
// =========================================================

function startAuthListener() {
    auth.onAuthStateChanged(async (user) => {
        // 【修正】認証状態が確定した時点でローディングを非表示にする
        loadingSpinner.style.display = 'none';

        if (user) {
            currentUser = user;
            document.getElementById('user-info').textContent = user.email;
            
            // ログイン済みならメインアプリを表示
            authStatusDiv.style.display = 'none';
            appContainer.style.display = 'flex';

            // 自分の情報をusersコレクションに保存 (オンライン通知代わり)
            await db.collection('users').doc(user.uid).set({
                email: user.email,
                uid: user.uid,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            startChatListener();   
            startUserListListener(); 
            startIncomingCallListener(); 
        } else {
            currentUser = null;
            // 未ログインなら認証画面を表示
            authStatusDiv.style.display = 'block';
            appContainer.style.display = 'none';
        }
    });
}


// =========================================================
// 4. ユーザーリスト & チャット
// =========================================================

// オンラインユーザー一覧を表示
function startUserListListener() {
    // 自分以外のユーザーを表示
    db.collection('users').onSnapshot(snapshot => {
        usersContainer.innerHTML = '';
        snapshot.forEach(doc => {
            const userData = doc.data();
            if (userData.uid !== currentUser.uid) {
                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `
                    <span>${userData.email.split('@')[0]}</span>
                    <button onclick="startCall('${userData.uid}', '${userData.email}')">📞 通話</button>
                `;
                usersContainer.appendChild(div);
            }
        });
    });
}

// チャット送信
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (text && currentUser) {
        db.collection('chats').add({
            text: text,
            uid: currentUser.uid,
            email: currentUser.email,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        input.value = '';
    }
}

// チャット受信 (LINE風表示)
function startChatListener() {
    const chatArea = document.getElementById('chat-area');
    db.collection('chats').orderBy('timestamp', 'asc').limit(50).onSnapshot(snapshot => {
        chatArea.innerHTML = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const isMe = data.uid === currentUser.uid;
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${isMe ? 'my-message' : 'other-message'}`;
            
            // 相手の名前を表示
            if (!isMe) {
                const nameSpan = document.createElement('span');
                nameSpan.className = 'sender-name';
                nameSpan.textContent = data.email.split('@')[0];
                msgDiv.appendChild(nameSpan);
            }
            
            const textNode = document.createTextNode(data.text);
            msgDiv.appendChild(textNode);
            chatArea.appendChild(msgDiv);
        });
        chatArea.scrollTop = chatArea.scrollHeight;
    });
}

// =========================================================
// 5. 1対1 WebRTC 通話機能
// =========================================================

// カメラ取得関数 (facingMode対応)
async function getLocalStream() {
    try {
        const constraints = {
            audio: true,
            video: { facingMode: currentFacingMode }
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        return true;
    } catch (e) {
        console.error("カメラ取得エラー", e);
        return false;
    }
}

// 通話開始 (発信)
window.startCall = async (targetUid, targetEmail) => {
    if (!await getLocalStream()) return;
    
    // 1対1用の通話IDを作成 (辞書順で並べ替え)
    const uids = [currentUser.uid, targetUid].sort();
    currentCallId = `${uids[0]}_${uids[1]}`;
    
    // UI表示
    callOverlay.style.display = 'flex';
    callStatus.textContent = `${targetEmail.split('@')[0]} さんに発信中...`;
    
    setupPeerConnection();
    
    const callDoc = db.collection('calls').doc(currentCallId);
    
    // 過去のゴミデータを掃除
    const candidates = await callDoc.collection('candidates').get();
    candidates.forEach(doc => doc.ref.delete());
    
    // Offer作成
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // 発信情報を書き込み 
    await callDoc.set({
        offer: { type: offer.type, sdp: offer.sdp },
        callerUid: currentUser.uid,
        calleeUid: targetUid, 
        answer: null
    });

    // Answer待ち受け
    const unsubscribe = callDoc.onSnapshot(async (snapshot) => {
        const data = snapshot.data();
        if (data && data.answer && !peerConnection.currentRemoteDescription) {
            const answerDesc = new RTCSessionDescription(data.answer);
            await peerConnection.setRemoteDescription(answerDesc);
            callStatus.textContent = '接続しました';
            unsubscribe();
        }
    });
};

// 着信監視 (自分宛ての電話だけを拾う)
function startIncomingCallListener() {
    db.collection('calls').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                
                if (data.calleeUid === currentUser.uid && data.offer && !data.answer) {
                    if (callOverlay.style.display !== 'flex') {
                        db.collection('users').doc(data.callerUid).get().then(doc => {
                            const callerEmail = doc.data()?.email || '不明なユーザー';
                            showIncomingCallModal(change.doc.id, callerEmail.split('@')[0]);
                        });
                    }
                }
            }
        });
    });
}

// 着信モーダル表示
let incomingCallId = null;
function showIncomingCallModal(callId, callerName) {
    incomingCallId = callId;
    document.getElementById('caller-name').textContent = `${callerName} さんから電話です`;
    incomingModal.style.display = 'block';
}

// 応答ボタン処理
async function answerCall() {
    incomingModal.style.display = 'none';
    currentCallId = incomingCallId;
    
    if (!await getLocalStream()) return;
    
    callOverlay.style.display = 'flex';
    callStatus.textContent = '接続中...';
    
    setupPeerConnection();
    
    const callDoc = db.collection('calls').doc(currentCallId);
    const doc = await callDoc.get();
    const data = doc.data();
    
    // Offer設定
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    
    // Answer作成
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    await callDoc.update({
        answer: { type: answer.type, sdp: answer.sdp }
    });
}

// 拒否ボタン処理
function rejectCall() {
    incomingModal.style.display = 'none';
    if (incomingCallId) {
         db.collection('calls').doc(incomingCallId).delete().catch(console.error);
    }
}


// PeerConnection共通セットアップ
function setupPeerConnection() {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(configuration);
    
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }
    
    peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };
    
    // ICE Candidate処理
    const callDoc = db.collection('calls').doc(currentCallId);
    
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            callDoc.collection('candidates').add(event.candidate.toJSON());
        }
    };
    
    callDoc.collection('candidates').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                // 【修正】リモート設定前かどうかチェック
                if (peerConnection && peerConnection.remoteDescription) {
                    try { await peerConnection.addIceCandidate(candidate); }
                    catch (e) { console.error("Candidate追加エラー:", e); }
                } else {
                     console.log("リモート記述設定前なのでCandidateの追加をスキップしました。");
                }
            }
        });
    });
    
    // 切断監視
    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            endCall();
        }
    };
}


// =========================================================
// 6. カメラ切り替え & 通話終了
// =========================================================

// カメラ切り替え (スマホ用)
async function switchCamera() {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    await getLocalStream();
    
    // PeerConnectionの映像トラックを差し替える
    if (peerConnection && localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(videoTrack);
        }
    }
}

// 通話終了
function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    callOverlay.style.display = 'none';
    localStream = null;
    peerConnection = null;
    currentCallId = null;
    // UIをリセットしてユーザーリストを再読み込み
    document.getElementById('users-container').innerHTML = '';
    if (currentUser) {
        startUserListListener();
    }
}
