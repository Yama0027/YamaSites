// =========================================================
// 1. Firebase設定と初期化
// =========================================================

// 🚨🚨🚨 あなたのFirebaseプロジェクトの設定に置き換えてください 🚨🚨🚨
const firebaseConfig = {
  apiKey: "AIzaSyDjDgy_QanVzmgdUs9t86qfEsTeSTXJnaY",
  authDomain: "nasuweb-467f9.firebaseapp.com",
  projectId: "nasuweb-467f9",
  storageBucket: "nasuweb-467f9.firebasestorage.app",
  messagingSenderId: "23088520786",
  appId: "1:23088520786:web:cef756e264b7f64214498b"
};

// グローバル変数
let auth, db;
let currentUser = null;
let currentCallId = null;
let localStream = null;
let peerConnection = null;
let currentFacingMode = 'user';
let notificationPermissionGranted = false;
let incomingCallId = null;
let chatNotificationsEnabled = true; // チャット通知の設定

// WebRTC設定
const configuration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

// Firebase初期化
try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    console.log("Firebase初期化成功");
} catch(e) {
    console.error("Firebase初期化エラー:", e);
    document.getElementById('loading-spinner').innerHTML = 
        '<p style="color: #ff3b30;">Firebaseの初期化に失敗しました</p>';
}

// =========================================================
// 2. DOM要素の取得とイベントリスナー
// =========================================================

window.addEventListener('DOMContentLoaded', function() {
    // DOM要素の取得
    const authStatusDiv = document.getElementById('auth-status');
    const appContainer = document.getElementById('app-container');
    const loadingSpinner = document.getElementById('loading-spinner');

    // イベントリスナーの設定
    document.getElementById('signInButton').addEventListener('click', handleSignIn);
    document.getElementById('signUpButton').addEventListener('click', handleSignUp);
    document.getElementById('signOutButton').addEventListener('click', handleSignOut);
    document.getElementById('sendMessageButton').addEventListener('click', sendMessage);
    document.getElementById('switchCameraButton').addEventListener('click', switchCamera);
    document.getElementById('hangupButton').addEventListener('click', endCall);
    document.getElementById('answerButton').addEventListener('click', answerCall);
    document.getElementById('rejectButton').addEventListener('click', () => rejectCall(true));
    document.getElementById('addFriendButton').addEventListener('click', addFriendByEmail);
    document.getElementById('chatNotificationToggle').addEventListener('change', handleNotificationToggle);
    
    // Enterキーでメッセージ送信
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // 保存された通知設定を読み込む
    loadNotificationSettings();

    // 認証状態の監視を開始
    startAuthListener();
});

// =========================================================
// 3. 認証関連
// =========================================================

function handleSignIn() {
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    
    if (!email || !password) {
        showAuthError("メールアドレスとパスワードを入力してください");
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
        .catch(e => {
            console.error("サインインエラー:", e);
            showAuthError(`サインイン失敗: ${e.message}`);
        });
}

function handleSignUp() {
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;
    
    if (!email || !password) {
        showAuthError("メールアドレスとパスワードを入力してください");
        return;
    }
    if (password.length < 6) {
        showAuthError("パスワードは6文字以上で入力してください");
        return;
    }

    auth.createUserWithEmailAndPassword(email, password)
        .then(() => {
            showAuthError("サインアップ成功！", "green");
        })
        .catch(e => {
            console.error("サインアップエラー:", e);
            showAuthError(`サインアップ失敗: ${e.message}`);
        });
}

function handleSignOut() {
    if (currentUser) {
        db.collection("users").doc(currentUser.uid).delete()
            .catch(console.error);
    }
    auth.signOut();
}

function showAuthError(message, type = "red") {
    const authStatusDiv = document.getElementById('auth-status');
    document.querySelectorAll('#auth-status .auth-message').forEach(e => e.remove());

    const errorMsg = document.createElement('p');
    errorMsg.className = 'auth-message text-sm mt-2 font-semibold';
    errorMsg.style.color = type === 'green' ? '#34c759' : '#ff3b30';
    errorMsg.textContent = message;
    authStatusDiv.appendChild(errorMsg);

    setTimeout(() => errorMsg.remove(), 5000);
}

function startAuthListener() {
    auth.onAuthStateChanged(async (user) => {
        document.getElementById('loading-spinner').style.display = 'none';

        if (user) {
            currentUser = user;
            document.getElementById('user-info').textContent = 
                `${user.email.split('@')[0]} (ID: ${user.uid.substring(0, 8)}...)`;
            
            document.getElementById('auth-status').style.display = 'none';
            document.getElementById('app-container').style.display = 'flex';

            await requestNotificationPermission();

            // ユーザー情報を保存
            await db.collection("users").doc(user.uid).set({
                email: user.email,
                uid: user.uid,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                online: true
            }, { merge: true });

            startChatListener();
            startUserListListener();
            startIncomingCallListener();
        } else {
            currentUser = null;
            document.getElementById('auth-status').style.display = 'block';
            document.getElementById('app-container').style.display = 'none';
        }
    });
}

// =========================================================
// 4. 通知機能
// =========================================================

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.warn("このブラウザは通知をサポートしていません");
        return;
    }

    if (Notification.permission === 'granted') {
        notificationPermissionGranted = true;
        return;
    }

    if (Notification.permission !== 'denied') {
        try {
            const permission = await Notification.requestPermission();
            notificationPermissionGranted = (permission === 'granted');
            
            if (notificationPermissionGranted) {
                showCustomMessage("通知が有効になりました 🔔", 'green');
            }
        } catch (error) {
            console.error("通知権限エラー:", error);
        }
    }
}

function displayNotification(title, body, type = 'chat') {
    // チャット通知の場合は設定を確認
    if (type === 'chat' && !chatNotificationsEnabled) {
        return;
    }
    
    // 通話通知は常に表示
    if (notificationPermissionGranted && document.visibilityState !== 'visible') {
        const notification = new Notification(title, {
            body: body,
            icon: 'https://placehold.co/64x64/00c300/ffffff?text=L',
            badge: 'https://placehold.co/64x64/00c300/ffffff?text=L',
            tag: type === 'chat' ? 'chat-notification' : 'call-notification',
            requireInteraction: type === 'call' // 通話通知は手動で閉じる必要がある
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        
        // 音を鳴らす（チャット通知のみ）
        if (type === 'chat') {
            playNotificationSound();
        }
    }
}

function playNotificationSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGe77eedSw8NUKfj8LZjHAY4kdfzzHksBS+EzvHahDUHFmK57OmhUBALTKHe8bt1KAQocMbv2pA/CRVitu3r');
    audio.volume = 0.3;
    audio.play().catch(e => console.log('通知音の再生に失敗:', e));
}

function handleNotificationToggle(event) {
    chatNotificationsEnabled = event.target.checked;
    
    // 設定を保存
    localStorage.setItem('chatNotificationsEnabled', chatNotificationsEnabled);
    
    if (chatNotificationsEnabled) {
        showCustomMessage("チャット通知をオンにしました 🔔", 'green');
        // 通知権限がない場合は要求
        if (!notificationPermissionGranted) {
            requestNotificationPermission();
        }
    } else {
        showCustomMessage("チャット通知をオフにしました 🔕", 'red');
    }
}

function loadNotificationSettings() {
    const saved = localStorage.getItem('chatNotificationsEnabled');
    if (saved !== null) {
        chatNotificationsEnabled = saved === 'true';
        document.getElementById('chatNotificationToggle').checked = chatNotificationsEnabled;
    }
}

// =========================================================
// 5. フレンド機能
// =========================================================

async function addFriendByEmail() {
    const email = document.getElementById('friendEmailInput').value.trim();
    if (!email || email === currentUser.email) {
        showCustomMessage("無効なメールアドレスです", 'red');
        return;
    }

    try {
        const usersSnapshot = await db.collection('users')
            .where('email', '==', email).get();

        if (usersSnapshot.empty) {
            showCustomMessage(`ユーザー ${email} が見つかりません`, 'red');
            return;
        }

        const friendDoc = usersSnapshot.docs[0];
        const friendUid = friendDoc.id;

        await db.collection('friends').doc(currentUser.uid)
            .collection('list').doc(friendUid).set({
                uid: friendUid,
                email: email,
                addedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

        showCustomMessage(`${email.split('@')[0]} を追加しました！`, 'green');
        document.getElementById('friendEmailInput').value = '';

    } catch (e) {
        console.error("フレンド追加エラー:", e);
        showCustomMessage("エラーが発生しました", 'red');
    }
}

function showCustomMessage(message, type) {
    const container = document.querySelector('.left-panel');
    let msgDiv = document.createElement('div');
    msgDiv.textContent = message;
    msgDiv.className = 'p-2 mt-2 rounded-lg text-sm font-semibold';
    msgDiv.style.color = 'white';
    msgDiv.style.backgroundColor = type === 'green' ? '#34c759' : '#ff3b30';
    container.insertBefore(msgDiv, container.querySelector('.users-list'));

    setTimeout(() => msgDiv.remove(), 4000);
}

function startUserListListener() {
    const onlineUsers = {};
    let friends = {};

    // オンラインユーザーの監視
    db.collection('users').onSnapshot(snapshot => {
        Object.keys(onlineUsers).forEach(key => delete onlineUsers[key]);
        
        snapshot.forEach(doc => {
            const userData = doc.data();
            const now = Date.now();
            const lastSeenTime = userData.lastSeen ? 
                (userData.lastSeen.toDate ? userData.lastSeen.toDate().getTime() : now) : now;
            
            if (userData.uid !== currentUser.uid && (now - lastSeenTime) < 300000) {
                onlineUsers[userData.uid] = userData;
            }
        });
        renderFriendList(friends, onlineUsers);
    });

    // フレンドリストの監視
    db.collection('friends').doc(currentUser.uid).collection('list')
        .onSnapshot(snapshot => {
            Object.keys(friends).forEach(key => delete friends[key]);
            snapshot.forEach(doc => {
                friends[doc.id] = doc.data();
            });
            renderFriendList(friends, onlineUsers);
        });
}

function renderFriendList(friends, onlineUsers) {
    const container = document.getElementById('users-container');
    container.innerHTML = '';
    
    const friendUids = Object.keys(friends);

    if (friendUids.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999; margin-top:20px;">フレンドを追加してください</p>';
        return;
    }

    friendUids.forEach(uid => {
        const friendData = friends[uid];
        const isOnline = !!onlineUsers[uid];
        const displayData = isOnline ? onlineUsers[uid] : friendData;
        
        const div = document.createElement('div');
        div.className = `user-item ${isOnline ? 'online' : 'offline'}`;
        div.innerHTML = `
            <div class="user-info-status">
                <span class="online-dot"></span>
                <span class="font-semibold">${displayData.email.split('@')[0]}</span>
                <span class="text-xs text-gray-500" style="margin-left: 8px;">${isOnline ? '(Online)' : '(Offline)'}</span>
            </div>
            ${isOnline 
                ? `<button onclick="startCall('${displayData.uid}', '${displayData.email}')">📞 通話</button>`
                : `<button onclick="removeFriend('${displayData.uid}', '${displayData.email}')" style="background-color: #ff3b30;">削除</button>`
            }
        `;
        container.appendChild(div);
    });
}

window.removeFriend = async (friendUid, friendEmail) => {
    if (confirm(`${friendEmail.split('@')[0]} を削除しますか？`)) {
        try {
            await db.collection('friends').doc(currentUser.uid)
                .collection('list').doc(friendUid).delete();
            showCustomMessage(`${friendEmail.split('@')[0]} を削除しました`, 'green');
        } catch(e) {
            console.error("削除エラー:", e);
            showCustomMessage("削除に失敗しました", 'red');
        }
    }
}

// =========================================================
// 6. チャット機能
// =========================================================

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

function startChatListener() {
    const chatArea = document.getElementById('chat-area');
    
    db.collection('chats')
        .orderBy('timestamp', 'asc')
        .limit(50)
        .onSnapshot(snapshot => {
            let newMessages = [];

            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    if (data.uid !== currentUser.uid && data.text) {
                        newMessages.push(data);
                    }
                }
            });

            // 新しいメッセージがあれば通知
            if (newMessages.length > 0 && chatNotificationsEnabled) {
                newMessages.forEach(data => {
                    const senderName = data.email ? data.email.split('@')[0] : 'ゲスト';
                    displayNotification(`💬 ${senderName}`, data.text, 'chat');
                });
            }

            chatArea.innerHTML = '';
            snapshot.forEach(doc => {
                const data = doc.data();
                if (!data.text) return;

                const isMe = data.uid === currentUser.uid;
                const userName = data.email ? data.email.split('@')[0] : 'ゲスト';
                const timeString = formatTimestamp(data.timestamp);
                
                const rowDiv = document.createElement('div');
                rowDiv.className = `message-row ${isMe ? 'my-message-row' : 'other-message-row'}`;
                
                const timeSpan = document.createElement('span');
                timeSpan.className = 'timestamp';
                timeSpan.textContent = timeString;

                const msgDiv = document.createElement('div');
                msgDiv.className = 'message';
                
                if (!isMe) {
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'sender-name';
                    nameSpan.textContent = userName;
                    msgDiv.appendChild(nameSpan);
                }
                
                msgDiv.appendChild(document.createTextNode(data.text));
                
                if (isMe) {
                    rowDiv.appendChild(timeSpan);
                    rowDiv.appendChild(msgDiv);
                } else {
                    rowDiv.appendChild(msgDiv);
                    rowDiv.appendChild(timeSpan);
                }

                chatArea.appendChild(rowDiv);
            });
            
            chatArea.scrollTop = chatArea.scrollHeight;
        });
}

function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// =========================================================
// 7. WebRTC通話機能
// =========================================================

async function getLocalStream() {
    try {
        const constraints = {
            audio: true,
            video: { facingMode: currentFacingMode }
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        document.getElementById('localVideo').srcObject = localStream;
        return true;
    } catch (e) {
        console.error("カメラ取得エラー", e);
        return false;
    }
}

window.startCall = async (targetUid, targetEmail) => {
    console.log('通話開始:', targetUid);
    
    if (!await getLocalStream()) {
        showCustomMessage("カメラ/マイクのアクセスが拒否されました", 'red');
        return;
    }
    
    const uids = [currentUser.uid, targetUid].sort();
    currentCallId = `${uids[0]}_${uids[1]}`;
    console.log('通話ID:', currentCallId);
    
    document.getElementById('call-overlay').style.display = 'flex';
    document.getElementById('call-status').textContent = `${targetEmail.split('@')[0]} に発信中...`;
    
    setupPeerConnection();
    
    const callDocRef = db.collection('calls').doc(currentCallId);
    
    // 古いcandidatesを削除
    try {
        const candidatesSnapshot = await callDocRef.collection('candidates').get();
        const batch = db.batch();
        candidatesSnapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log('古いCandidatesを削除');
    } catch(e) {
        console.error("Candidates削除エラー:", e);
    }

    // Offer作成
    const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    });
    console.log('Offer作成:', offer);
    
    await peerConnection.setLocalDescription(offer);
    console.log('LocalDescription設定完了');
    
    await callDocRef.set({
        offer: { type: offer.type, sdp: offer.sdp },
        callerUid: currentUser.uid,
        calleeUid: targetUid,
        answer: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('Offerを送信');

    const unsubscribe = callDocRef.onSnapshot(async (snapshot) => {
        const data = snapshot.data();
        
        if (data && data.answer && !peerConnection.currentRemoteDescription) {
            console.log('Answer受信:', data.answer);
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log('RemoteDescription設定完了');
                document.getElementById('call-status').textContent = '接続中...';
            } catch (e) {
                console.error("Answer設定エラー:", e);
                document.getElementById('call-status').textContent = '接続エラー';
                setTimeout(endCall, 2000);
            }
        }
        
        if (!data || !data.offer) {
            if(document.getElementById('call-overlay').style.display === 'flex') {
                console.log('相手が通話を終了');
                document.getElementById('call-status').textContent = '相手が通話を終了しました';
                setTimeout(endCall, 2000);
            }
            unsubscribe();
        }
    });
};

function startIncomingCallListener() {
    db.collection('calls').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            const data = change.doc.data();

            if (data.calleeUid === currentUser.uid && data.offer && !data.answer) {
                if (change.type === 'added' || (change.type === 'modified' && !incomingCallId)) {
                    if (document.getElementById('call-overlay').style.display !== 'flex' && 
                        document.getElementById('incoming-call-modal').style.display !== 'flex') {
                        
                        const incomingCallSound = document.getElementById('incomingCallSound');
                        try { 
                            incomingCallSound.play(); 
                        } catch(e) { 
                            console.warn("着信音再生エラー:", e); 
                        }
                        
                        const callerDoc = await db.collection('users').doc(data.callerUid).get();
                        const callerEmail = callerDoc.exists ? callerDoc.data().email : '不明';
                        const callerName = callerEmail.split('@')[0];
                        
                        displayNotification(`📞 着信 (${callerName})`, `${callerName}さんから通話`, 'call');
                        showIncomingCallModal(change.doc.id, callerName);
                    }
                }
            } else if (!data.offer && change.doc.id === incomingCallId) {
                rejectCall(false);
                showCustomMessage("相手が通話をキャンセルしました", 'red');
            }
        });
    });
}

function showIncomingCallModal(callId, callerName) {
    incomingCallId = callId;
    document.getElementById('caller-name').textContent = `${callerName} さんから電話です`;
    document.getElementById('incoming-call-modal').style.display = 'flex';
}

async function answerCall() {
    console.log('着信応答:', incomingCallId);
    
    document.getElementById('incoming-call-modal').style.display = 'none';
    const incomingCallSound = document.getElementById('incomingCallSound');
    incomingCallSound.pause();
    incomingCallSound.currentTime = 0;
    
    currentCallId = incomingCallId;
    incomingCallId = null;
    
    if (!await getLocalStream()) {
        showCustomMessage("カメラ/マイクのアクセスが拒否されました", 'red');
        return;
    }
    
    document.getElementById('call-overlay').style.display = 'flex';
    document.getElementById('call-status').textContent = '接続中...';
    
    setupPeerConnection();
    
    const callDocRef = db.collection('calls').doc(currentCallId);
    const docSnap = await callDocRef.get();
    
    if (!docSnap.exists || !docSnap.data().offer) {
        console.error("通話データが見つかりません");
        endCall();
        return;
    }

    const data = docSnap.data();
    console.log('Offer受信:', data.offer);
    
    // RemoteDescriptionを設定
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    console.log('RemoteDescription設定完了');
    
    // Answer作成
    const answer = await peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    });
    console.log('Answer作成:', answer);
    
    await peerConnection.setLocalDescription(answer);
    console.log('LocalDescription設定完了');
    
    // Answerを送信
    await callDocRef.set({
        answer: { type: answer.type, sdp: answer.sdp }
    }, { merge: true });
    console.log('Answerを送信');
}

function rejectCall(deleteFirestore = true) {
    document.getElementById('incoming-call-modal').style.display = 'none';
    const incomingCallSound = document.getElementById('incomingCallSound');
    incomingCallSound.pause();
    incomingCallSound.currentTime = 0;

    if (incomingCallId && deleteFirestore) {
        db.collection('calls').doc(incomingCallId).delete().catch(console.error);
    }
    incomingCallId = null;
}

function setupPeerConnection() {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(configuration);
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log('ローカルトラック追加:', track.kind);
            peerConnection.addTrack(track, localStream);
        });
    }
    
    peerConnection.ontrack = event => {
        console.log('リモートトラック受信:', event.track.kind);
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log('リモートビデオ設定完了');
        }
        document.getElementById('call-status').textContent = '接続しました';
    };
    
    const callDocRef = db.collection('calls').doc(currentCallId);
    const candidatesRef = callDocRef.collection('candidates');
    
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log('ICE Candidate送信');
            candidatesRef.add(event.candidate.toJSON()).catch(e => {
                console.error("Candidate送信エラー:", e);
            });
        }
    };
    
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE接続状態:', peerConnection.iceConnectionState);
        document.getElementById('call-status').textContent = 
            `ICE状態: ${peerConnection.iceConnectionState}`;
    };
    
    candidatesRef.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added') {
                const candidateData = change.doc.data();
                console.log('ICE Candidate受信:', candidateData);
                
                if (peerConnection && peerConnection.signalingState !== 'closed') {
                    try {
                        const candidate = new RTCIceCandidate(candidateData);
                        await peerConnection.addIceCandidate(candidate);
                        console.log('Candidate追加成功');
                    } catch (e) {
                        console.error("Candidate追加エラー:", e);
                    }
                }
            }
        });
    });
    
    peerConnection.onconnectionstatechange = () => {
        console.log('接続状態:', peerConnection.connectionState);
        if (['disconnected', 'failed', 'closed'].includes(peerConnection.connectionState)) {
            if (document.getElementById('call-overlay').style.display === 'flex') {
                document.getElementById('call-status').textContent = '接続が切れました';
                setTimeout(endCall, 2000);
            }
        }
    };
}

async function switchCamera() {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    const success = await getLocalStream();

    if (success && peerConnection && localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(videoTrack);
        }
    }
}

function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    if (currentCallId) {
        db.collection('calls').doc(currentCallId).delete().catch(console.error);
    }
    
    document.getElementById('call-overlay').style.display = 'none';
    document.getElementById('incoming-call-modal').style.display = 'none';
    const incomingCallSound = document.getElementById('incomingCallSound');
    incomingCallSound.pause();
    incomingCallSound.currentTime = 0;
    
    localStream = null;
    peerConnection = null;
    currentCallId = null;
    incomingCallId = null;
}
