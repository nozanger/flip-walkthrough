importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBcKTjlFLaExaFuSiuRusH2MDpCm8VzlDQ',
  authDomain: 'zanco-e2a3f.firebaseapp.com',
  projectId: 'zanco-e2a3f',
  storageBucket: 'zanco-e2a3f.firebasestorage.app',
  messagingSenderId: '88624874228',
  appId: '1:88624874228:web:ed33337ee08d4bc54394a1',
  databaseURL: 'https://zanco-e2a3f-default-rtdb.firebaseio.com',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon.png',
    badge: '/icon.png',
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('https://zanco.netlify.app'));
});
