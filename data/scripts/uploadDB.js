'use strict'
require('dotenv').config()
const fs = require('fs')
const { ObjectID, MongoClient } = require('mongodb')

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

const uri = `mongodb+srv://soundspeller:${process.env.DB_PASSWORD}@cluster0-mbali.azure.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
const client = new MongoClient(uri, { useNewUrlParser: true })
// const objectInstance = new ObjectID();
client.connect(async (err) => {
  if (err) console.log(err)
  const wordCollection = client.db(process.env.DB_NAME).collection('words')
  const phonemeCollection = client
    .db(process.env.DB_NAME)
    .collection('phonemes')
  const lessonCollection = client.db(process.env.DB_NAME).collection('lessons')

  var { phonemeDocs, phonemeIds } = await createPhonemeDocs()
  var { wordDocs, wordIds } = await createWordDocs(phonemeIds)
  var { lessonDocs } = await createLessonDocs(wordIds)
  const uploadPhonemes = phonemeCollection.insertMany(phonemeDocs);
  const uploadWords = wordCollection.insertMany(wordDocs);
  const uploadLessons = lessonCollection.insertMany(lessonDocs);
  Promise.all([uploadPhonemes, uploadWords, uploadLessons])
    .then(() => {
      console.log("Done!");
      client.close();
    })
    .catch((err) => {
      console.log("Borked :(\n", err);
    });
})

const createPhonemeDocs = () => {
  return new Promise((resolve, reject) => {
    var phonemeIds = {}
    var phonemeDocs = phonemes.map((phonemeItem, index) => {
      const phoneme = phonemeItem[0]
      const files = phonemeItem.slice(1)
      const _id = new ObjectID(index)
      phonemeIds[phoneme] = _id
      return {
        _id,
        phoneme,
        files,
      }
    })
    console.log(
      `Phoneme docs created. n=${phonemeDocs.length}\nSample=${JSON.stringify(
        phonemeDocs[6],
        null,
        2
      )}`
    )
    if (isExpectedLength('phonemes', phonemeDocs)) {
      resolve({ phonemeDocs, phonemeIds })
    } else {
      reject()
    }
  })
}

const createWordDocs = (phonemeIds) => {
  return new Promise((resolve, reject) => {
    var wordIds = {}
    var wordDocs = words.map((wordItem) => {
      const word = wordItem.word
      const graphemes = wordItem['grap'] ? wordItem['grap'].split(',') : ''
      const syllables = wordItem['syll'] ? wordItem['syll'].split('.') : ''
      var phonemes = wordItem['phon'] ? wordItem['phon'].split(/\s|-/) : ''
      const _id = new ObjectID();
      wordIds[word] = _id;
      return {
        _id,
        word,
        phonemes,
        graphemes,
        syllables,
      }
    })
    console.log(
      `Word docs created. n=${wordDocs.length}\nSample=${JSON.stringify(
        wordDocs[0],
        null,
        2
      )}`
    )
    if (isExpectedLength('words', wordDocs)) {
      resolve({ wordDocs, wordIds })
    } else {
      reject()
    }
  })
}

const createLessonDocs = () => {
  return new Promise((resolve, reject) => {
    var lessonDocs = lessons.map((lessonItem) => {
      const lesson_section = lessonItem.les_sec_num
      const lesson_id = lessonItem.les_num
      var wordListObj = data.wLst.filter((wListObj) => {
        return wListObj.word_list_id === lesson_id
      })[0]
      var words = wordListObj.word_list.split(/\s/)
      words = words.map((word) => word.toUpperCase())
      const title = lessonItem.les_title
      const description = lessonItem.les_desc

      const _id = new ObjectID()
      return {
        _id,
        lesson_section,
        lesson_id,
        words,
        title,
        description,
      }
    })
    console.log(
      `Lesson docs created. n=${lessonDocs.length}\nSample:${JSON.stringify(
        lessonDocs[0],
        null,
        2
      )}`
    )
    if (isExpectedLength('lessons', lessonDocs)) {
      resolve({ lessonDocs })
    } else {
      reject()
    }
  })
}

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
