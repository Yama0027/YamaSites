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
        { urls: 'turn:turn.openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// =========================================================
// 2. DOM要素とイベントリスナーの初期化 (HTML読み込み後実行)
// =========================================================
let authStatusDiv, appContainer, loadingSpinner, usersContainer, 
    signInButton, signUpButton, signOutButton, 
    sendMessageButton, switchCameraButton, hangupButton, 
    answerButton, rejectButton, addFriendButton, friendEmailInput, incomingCallSound,
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
    addFriendButton = document.getElementById('addFriendButton'); // 【新規】
    friendEmailInput = document.getElementById('friendEmailInput'); // 【新規】
    incomingCallSound = document.getElementById('incomingCallSound'); // 【新規】
    
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
            // ログアウト時にusersコレクションから自分のレコードを削除
            db.collection('users').doc(currentUser.uid).delete().catch(console.error);
        }
        auth.signOut();
    });

    sendMessageButton.addEventListener('click', sendMessage);
    switchCameraButton.addEventListener('click', switchCamera); 
    hangupButton.addEventListener('click', endCall); 
    answerButton.addEventListener('click', answerCall); 
    rejectButton.addEventListener('click', rejectCall); 
    addFriendButton.addEventListener('click', addFriendByEmail); // 【新規】フレンド追加リスナー

    // Firebase認証状態の監視を開始
    startAuthListener();
}


// =========================================================
// 3. 認証 & ユーザー管理 & フレンド機能
// =========================================================

function startAuthListener() {
    auth.onAuthStateChanged(async (user) => {
        // 認証状態が確定した時点でローディングを非表示にする
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
            startUserListListener(); // 【変更】フレンドリストの監視を開始
            startIncomingCallListener(); 
        } else {
            currentUser = null;
            // 未ログインなら認証画面を表示
            authStatusDiv.style.display = 'block';
            appContainer.style.display = 'none';
        }
    });
}

// 【新規】メールアドレスでフレンドを追加する
async function addFriendByEmail() {
    const email = friendEmailInput.value.trim();
    if (!email || email === currentUser.email) {
        alert("有効なメールアドレスを入力してください。または自分自身は追加できません。");
        return;
    }

    try {
        // 1. そのメールアドレスを持つユーザーを検索
        const usersSnapshot = await db.collection('users').where('email', '==', email).limit(1).get();

        if (usersSnapshot.empty) {
            alert("このメールアドレスを持つユーザーは見つかりませんでした。");
            return;
        }

        const friendDoc = usersSnapshot.docs[0];
        const friendUid = friendDoc.id;

        // 2. 自分のフレンドリストに追加
        await db.collection('friends').doc(currentUser.uid).collection('list').doc(friendUid).set({
            uid: friendUid,
            email: email,
            addedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(`${email.split('@')[0]} さんをフレンドに追加しました！`);
        friendEmailInput.value = '';

    } catch (e) {
        console.error("フレンド追加エラー:", e);
        alert("フレンド追加中にエラーが発生しました。");
    }
}

// 【新規】フレンドリストの監視と表示
function startUserListListener() {
    const onlineUsers = {}; // オンライン状態にある全ユーザーを保持
    let friends = {};       // 自分のフレンドリストを保持

    // 1. オンラインユーザーの監視
    db.collection('users').onSnapshot(onlineSnapshot => {
        onlineUsers.length = 0; // リセット
        onlineSnapshot.forEach(doc => {
            const userData = doc.data();
            if (userData.uid !== currentUser.uid) {
                onlineUsers[userData.uid] = userData;
            }
        });
        renderFriendList(friends, onlineUsers);
    });

    // 2. 自分のフレンドリストの監視
    db.collection('friends').doc(currentUser.uid).collection('list').onSnapshot(friendSnapshot => {
        friends = {}; // リセット
        friendSnapshot.forEach(doc => {
            const friendData = doc.data();
            friends[friendData.uid] = friendData;
        });
        renderFriendList(friends, onlineUsers);
    });
}

// 【新規】フレンドリストのDOM描画
function renderFriendList(friends, onlineUsers) {
    usersContainer.innerHTML = '';
    
    const friendUids = Object.keys(friends);

    if (friendUids.length === 0) {
        usersContainer.innerHTML = '<p style="text-align:center; color:#999; margin-top:20px;">まだフレンドがいません。「フレンドのメールアドレス」を入力して追加しましょう。</p>';
        return;
    }

    friendUids.forEach(uid => {
        const friendData = friends[uid];
        const isOnline = !!onlineUsers[uid]; // オンラインユーザーリストに存在するか
        const displayData = isOnline ? onlineUsers[uid] : friendData;
        
        const div = document.createElement('div');
        div.className = `user-item ${isOnline ? 'online' : 'offline'}`;
        div.innerHTML = `
            <div class="user-info-status">
                <span class="online-dot"></span>
                <span>${displayData.email.split('@')[0]} ${isOnline ? '(Online)' : '(Offline)'}</span>
            </div>
            ${isOnline 
                ? `<button onclick="startCall('${displayData.uid}', '${displayData.email}')">📞 通話</button>`
                : `<button onclick="removeFriend('${displayData.uid}', '${displayData.email}')" style="background-color: #ff3b30;">削除</button>`
            }
        `;
        usersContainer.appendChild(div);
    });
}

// 【新規】フレンド削除
window.removeFriend = async (friendUid, friendEmail) => {
    if (confirm(`${friendEmail.split('@')[0]} さんをフレンドリストから削除しますか？`)) {
        try {
            await db.collection('friends').doc(currentUser.uid).collection('list').doc(friendUid).delete();
        } catch(e) {
            console.error("フレンド削除エラー:", e);
            alert("フレンド削除中にエラーが発生しました。");
        }
    }
}


// =========================================================
// 4. チャット
// =========================================================

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

// タイムスタンプを "hh:mm" 形式に整形するヘルパー関数
function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// チャット受信 (LINE風表示)
function startChatListener() {
    const chatArea = document.getElementById('chat-area');
    db.collection('chats').orderBy('timestamp', 'asc').limit(50).onSnapshot(snapshot => {
        chatArea.innerHTML = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            
            // メッセージテキストがないドキュメントはスキップ
            if (!data.text || typeof data.text !== 'string') return; 

            try { 
                const isMe = data.uid === currentUser.uid;
                const userName = data.email ? data.email.split('@')[0] : 'ゲスト';
                const timeString = formatTimestamp(data.timestamp); // 日時を整形
                
                // 全体をラップする row div
                const rowDiv = document.createElement('div');
                rowDiv.className = `message-row ${isMe ? 'my-message-row' : 'other-message-row'}`;
                
                // タイムスタンプ
                const timeSpan = document.createElement('span');
                timeSpan.className = 'timestamp';
                timeSpan.textContent = timeString;

                // メッセージ本体
                const msgDiv = document.createElement('div');
                msgDiv.className = 'message';
                
                // ユーザー名 (相手のメッセージでのみ表示)
                if (!isMe) {
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'sender-name';
                    nameSpan.textContent = userName;
                    msgDiv.appendChild(nameSpan);
                }
                
                const textNode = document.createTextNode(data.text);
                msgDiv.appendChild(textNode);
                
                // 要素の追加順序を決定
                if (isMe) {
                    // 自分: [日時] [メッセージ]
                    rowDiv.appendChild(timeSpan);
                    rowDiv.appendChild(msgDiv);
                } else {
                    // 相手: [メッセージ] [日時] (メッセージの中にユーザー名を含む)
                    rowDiv.appendChild(msgDiv);
                    rowDiv.appendChild(timeSpan);
                }

                chatArea.appendChild(rowDiv);
            } catch (e) {
                console.error("チャットメッセージの表示中にエラーが発生しました:", e, data);
            }
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
        // alert("カメラやマイクが利用できません。権限を確認してください。");
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
                        // 【新規】着信時に音を鳴らす
                        try { incomingCallSound.play(); } catch(e) { console.warn("着信音再生エラー:", e); }
                        
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
    incomingCallSound.pause(); // 【新規】音を止める
    incomingCallSound.currentTime = 0;
    
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
    incomingCallSound.pause(); // 【新規】音を止める
    incomingCallSound.currentTime = 0;

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
                // リモート設定前かどうかチェック
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
    
    incomingCallSound.pause(); // 【新規】通話終了時も音を止める
    incomingCallSound.currentTime = 0;

    // UIをリセットしてユーザーリストを再読み込み
    document.getElementById('users-container').innerHTML = '';
    if (currentUser) {
        startUserListListener();
    }
}
