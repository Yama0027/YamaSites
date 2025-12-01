// WebRTC接続のためのSTUN/TURNサーバー設定
// STUNサーバーは無料のGoogleのものを使用。
// TURNサーバーはOpen Relay Projectの無料サーバーを使用していますが、
// 安定性・信頼性のため、本番環境では有料のサービスまたは独自のサーバーを使用することを強く推奨します。

const configuration = {
    iceServers: [
        // STUNサーバー (NAT越えのためのグローバルIPアドレス取得)
        { urls: 'stun:stun.l.google.com:19302' },
        
        // TURNサーバー (P2P接続が失敗した場合の中継)
        { 
            urls: 'turn:turn.openrelay.metered.ca:80', 
            username: 'openrelayproject', 
            credential: 'openrelayproject' 
        }
    ]
};


