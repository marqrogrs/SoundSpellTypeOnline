import React, { useContext, useState, useEffect } from 'react'
import { LinearProgress, Box, Typography } from '@material-ui/core'
import { LessonContext } from '../providers/LessonProvider'

export default function LessonProgress({ currentWordIndex }) {
  const { currentLesson } = useContext(LessonContext)
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (currentLesson) {
      if (currentWordIndex === 0) {
        setValue(0)
      } else {
        const { level, progress, lesson } = currentLesson
        const { completed_words } = progress[level]
        const total_words = lesson.words.length
        setValue(Math.round((parseInt(completed_words) / total_words) * 100))
      }
    }
  }, [currentLesson, currentWordIndex])
  return (
    <>
      <Typography>Progress:</Typography>
      <Box display='flex' alignItems='center'>
        <Box width='100%' mr={1}>
          <LinearProgress variant='determinate' value={value} />
        </Box>
        <Box minWidth={35}>
          <Typography variant='body2' color='textSecondary'>
            {`${value}%`}
          </Typography>
        </Box>
      </Box>
    </>
  )
}
