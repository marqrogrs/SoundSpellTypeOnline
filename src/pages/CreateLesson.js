import React, { useState, useContext } from 'react'
import { useHistory } from 'react-router-dom'

import swal from 'sweetalert'

import TextField from '@material-ui/core/TextField'
import Button from '@material-ui/core/Button'
import Container from '@material-ui/core/Container'
import Grid from '@material-ui/core/Grid'

import { LessonContext } from '../providers/LessonProvider'

export default function CreateLesson() {
  const [lessonWords, setLessonWords] = useState('')
  const [lessonTitle, setLessonTitle] = useState('')
  const [description, setDescription] = useState('')
  const history = useHistory()

  const { createLesson } = useContext(LessonContext)

  const handleSubmit = () => {
    const words = lessonWords
      .split(/[^A-Z]/gi)
      .filter((w) => w.length > 1)
      .map((w) => w.toUpperCase())
    createLesson({ title: lessonTitle, words, description })
      .then((res) => swal('Yippee!', `Lesson has been created.`, 'success'))
      .then(() => {
        history.push('/')
      })
      .catch((err) => {
        if (err.rejectedWords) {
          swal(
            'Oops!',
            `The following words could not be found: ${err.rejectedWords.join(
              ', '
            )}`,
            'error'
          )
        }
      })
  }

  return (
    <Container maxWidth='md'>
      <Grid container spacing={2} direction='column'>
        <TextField
          id='name'
          label='Lesson Name'
          value={lessonTitle}
          onChange={(e) => setLessonTitle(e.target.value)}
        />
        <TextField
          id='description'
          label='Lesson Description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {/* TODO: dropdown/multi-select of rule titles  */}
        <TextField
          id='words'
          label='Lesson Words'
          multiline
          rows={20}
          placeholder='Enter lesson words here'
          value={lessonWords}
          onChange={(e) => setLessonWords(e.target.value)}
        />
        <Button color='primary' variant='contained' onClick={handleSubmit}>
          Create Lesson
        </Button>
      </Grid>
    </Container>
  )
}
