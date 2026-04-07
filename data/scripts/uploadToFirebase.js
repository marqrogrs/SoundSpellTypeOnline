// 'use strict'
// import * as firebase from 'firebase/app'
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

const expectedPhonemes = 44
const expectedLessons = 70
const expectedWords = 53719

const data = require('../SoundSpellerDatabase.json')
const words = data.ssLexicon
const lessons = data.les
const { phonemes } = require('./data')
// var phonemes = [];
// words.forEach((word, index) => {
//   if (!word) {
//     console.log(index);
//     return;
//   }
//   var phonemesInWord = word["phon"].split(/\s|-/);
//   phonemesInWord.forEach((phoneme) => {
//     if (!phonemes.includes(phoneme)) {
//       phonemes.push(phoneme);
//     }
//   });
// });
// if (isExpectedLength("phonemes", phonemes)) {
//   console.log("Got all phonemes");
// }
// if (isExpectedLength("words", words)) {
//   console.log("Got all words");
// }
// if (isExpectedLength("lessons", lessons)) {
//   console.log("Got all lessons");
// }

// var { wordDocs, wordIds } = createWordDocs(phonemeIds)
// var { lessonDocs } = createLessonDocs(wordIds)

const batch = db.batch()
const wordCollection = db.collection('words')
const phonemeCollection = db.collection('phonemes')
const lessonCollection = db.collection('lessons')
const createPhonemeDocs = () => {
  phonemes.forEach((phonemeItem, index) => {
    const phoneme = phonemeItem[0]
    const files = phonemeItem.slice(1)
    phonemeCollection.doc(phoneme).set({ files, phoneme })
  })
}

const createWordDocs = () => {
  var startingIndex = 48836
  words.forEach((wordItem, i) => {
    if (startingIndex && i > startingIndex) {
      console.log(`Uploading ${i}: ${wordItem.word}`)
      const word = wordItem.word
      // const graphemes = wordItem['grap'] ? wordItem['grap'].split(',') : ''
      // const syllables = wordItem['syll'] ? wordItem['syll'].split('.') : ''
      var phonemes = wordItem['phon'].replace(/-/gi, ' - ')
      phonemes = phonemes.split(' ')
      if (word) {
        wordCollection.doc(word).set({ phonemes }, { merge: true })
      }
    }
  })
}

const createLessonDocs = () => {
  lessons.forEach((lessonItem) => {
    const lesson_section = lessonItem.les_sec_num
    const lesson_id = lessonItem.les_num
    var wordListObj = data.wLst.filter((wListObj) => {
      return wListObj.word_list_id === lesson_id
    })[0]
    var words = wordListObj.word_list.split(/\s/)
    words = words.map((word) => word.toUpperCase())
    const title = lessonItem.les_title
    const description = lessonItem.les_desc
    lessonCollection
      .doc(lesson_id)
      .set({ lesson_section, lesson_id, words, title, description })

    return {
      lesson_section,
      lesson_id,
      words,
      title,
      description,
    }
  })
}

// createPhonemeDocs()
console.log('Starting')
createWordDocs()
// createLessonDocs()
// console.log(batch)

// batch.commit()
function isExpectedLength(type, data) {
  var expected
  switch (type) {
    case 'phonemes':
      expected = expectedPhonemes
      break
    case 'lessons':
      expected = expectedLessons
      break
    case 'words':
      expected = expectedWords
      break
    default:
      break
  }
  if (data.length === expected) {
    return true
  } else {
    console.log(`${data.length}/${expected} ${type} found... Terminating.`)
    process.exit(1)
  }
}
