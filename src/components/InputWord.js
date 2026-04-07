import React from 'react'
import { Typography } from '@material-ui/core'
import { useStyles } from '../styles/material'

export default function InputWord({ word }) {
  const classes = useStyles()

  return (
    <>
      <Typography className={classes.word} variant='h1'>
        {word}
      </Typography>
    </>
  )
}
