const firebase = require('firebase/app')
require('firebase/firestore')

const firebaseConfig = {
  apiKey: 'AIzaSyBC9FNI_d_Lse9Kw1u_1jbWUvqcHShHXZQ',
  authDomain: 'soundspeller-c5e53.firebaseapp.com',
  databaseURL: 'https://soundspeller-c5e53.firebaseio.com',
  projectId: 'soundspeller-c5e53',
  storageBucket: 'soundspeller-c5e53.appspot.com',
  messagingSenderId: '254713323790',
  appId: '1:254713323790:web:34db07de840605a21b375f',
  measurementId: 'G-CMHKZ57DDP',
}

// Initialize Firebase
firebase.initializeApp(firebaseConfig)

const db = firebase.firestore()

db.collection('words')
  .where('phonemes', 'array-contains-any', ['JH'])
  .get()
  .then((queryRef) => {
    var i = 0
    queryRef.docs.forEach((doc) => {
      if (doc.data().graphemes.includes('NG')) {
        console.log(`Contains NG: ${doc.id}`)
        i++
      }
      if (doc.data().graphemes.includes(['N', 'G'])) {
        console.log(`Contains N G: ${doc.id}`)
        i++
      }
    })
    console.log(`Total: ${i}`)
  })
