import swal from 'sweetalert'
import { auth } from '../firebase'

export const triggerErrorAlert = (error) => {
  return swal('Oops!', error, 'error')
}

export const prettyPrintErrorCode = (errorCode) => {
  var newString = ''
  for (let i = 0; i < errorCode.length; i++) {
    if (errorCode[i] === errorCode[i].toUpperCase() && i > 0) {
      newString += ' '
    }
    newString += errorCode[i]
  }
  return newString
}

export const triggerEmailVerificationAlert = (email) => {
  return swal(
    'Almost there!',
    `Please follow the link in the email sent to ${email} to verify your account.`,
    'success'
  )
}

export const triggerEmailVerificationAlert2 = (email) => {
  return swal(
    `Must complete email verification to sign in. An email has been sent to ${email}.`,
    {
      buttons: {
        close: true,
        resend: {
          text: 'Resend Email',
          value: 'resend',
        },
      },
    }
  ).then((value) => {
    if (value === 'resend') {
      return auth.currentUser
        .sendEmailVerification()
        .then(swal(`Email sent to ${email}`))
    }
    return
  })
}

export const triggerResetPasswordAlert = () => {
  return swal('Please enter email: ', { content: 'input' }).then((email) => {
    auth
      .sendPasswordResetEmail(email)
      .then(() => {
        swal(
          `Email sent!`,
          `Follow the link sent to ${email} to reset password`,
          'success'
        )
      })
      .catch((err) => {
        swal(
          'Oops!',
          'Unable to locate a user with this email address. If you continue seeing this error, please contact help@scandy.co',
          'error'
        )
      })
  })
}
