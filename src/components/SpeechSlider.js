import React, { useState, useEffect } from 'react'

import Slider from '@material-ui/core/Slider'
import { changeSpeechSpeed, SPEECH_RATE } from '../util/Audio'
import Grid from '@material-ui/core/Grid'

import { useStyles } from '../styles/material'

const MARKS = [
  {
    value: 0,
    label: 'Slower',
  },
  {
    value: 25,
    label: 'Slow',
  },
  {
    value: 50,
    label: 'Normal',
  },
  {
    value: 75,
    label: 'Fast',
  },
  {
    value: 100,
    label: 'Faster',
  },
]

export default function SpeechSlider() {
  const [speed, setSpeed] = useState(50)
  const classes = useStyles()
  const handleChangeSpeed = (e, newSpeed) => {
    setSpeed(newSpeed)
  }

  const handleChangeSpeedCommitted = (e, newSpeed) => {
    changeSpeechSpeed(newSpeed)
  }

  useEffect(() => {
    var transformedSpeed
    switch (SPEECH_RATE) {
      case 0.5:
        transformedSpeed = 0
        break
      case 0.6:
        transformedSpeed = 25
        break
      case 1.0:
        transformedSpeed = 50
        break
      case 1.5:
        transformedSpeed = 75
        break
      case 2.0:
        transformedSpeed = 100
        break
      default:
        return
    }
    setSpeed(transformedSpeed)
  }, [])

  return (
    <Grid
      container
      style={{ width: 600 }}
      direction='column'
      alignItems='center'
    >
      Speed:
      <Slider
        className={classes.speechSlider}
        value={speed}
        onChange={handleChangeSpeed}
        onChangeCommitted={handleChangeSpeedCommitted}
        valueLabelDisplay='off'
        marks={MARKS}
        step={25}
      />
    </Grid>
  )
}
