import { Hono } from 'hono'
import { sign, verify } from 'hono/jwt'
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from '../utils/constants.js'
import { getDb } from '../data/db.js'
import { findUserByEmail, createUser } from '../data/users.repository.js'
import { createSession, findSessionByTokenHash, deleteSessionByTokenHash } from '../data/sessions.repository.js'
import { parseJsonBody } from '../utils/body.js'
import { ApiError } from '../utils/errors.js'
import { sendResource } from '../utils/response.js'
import { validateRegister, validateLogin, validateRefresh, validateLogout } from '../utils/validation.js'
import { hashPassword, verifyPassword, generateRefreshToken, hashToken } from '../utils/crypto.js'

export async function signAccessToken(payload, secret) {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    {
      ...payload,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
    },
    secret,
  )
}

export async function verifyAccessToken(token, secret) {
  return verify(token, secret, 'HS256')
}

export function refreshTokenExpiresAt() {
  const date = new Date()
  date.setDate(date.getDate() + REFRESH_TOKEN_TTL_DAYS)
  return date.toISOString()
}

const auth = new Hono()

auth.post('/register', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateRegister(payload)

  if (details.length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      details,
    )
  }

  const db = getDb(c.env.DB)
  
  // Check if user already exists
  const existingUser = await findUserByEmail(db, payload.email)
  if (existingUser) {
    throw new ApiError(409, 'CONFLICT', 'Email already registered.')
  }

  // Hash password and create user
  const passwordHash = await hashPassword(payload.password)
  const user = await createUser(db, {
    email: payload.email,
    passwordHash,
  })

  return sendResource(c, {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
  }, 201)
})

auth.post('/login', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateLogin(payload)

  if (details.length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      details,
    )
  }

  const db = getDb(c.env.DB)
  
  // Find user by email
  const user = await findUserByEmail(db, payload.email)
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password.')
  }

  // Verify password
  const isPasswordValid = await verifyPassword(payload.password, user.passwordHash)
  if (!isPasswordValid) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password.')
  }

  // Generate refresh token and access token
  const refreshToken = generateRefreshToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const expiresAt = refreshTokenExpiresAt()

  // Store refresh token in sessions
  await createSession(db, {
    userId: user.id,
    tokenHash: refreshTokenHash,
    expiresAt,
  })

  // Generate access token
  const accessToken = await signAccessToken(
    { sub: user.id, email: user.email },
    c.env.JWT_SECRET
  )

  return sendResource(c, {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  })
})

auth.post('/refresh', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateRefresh(payload)

  if (details.length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      details,
    )
  }

  const db = getDb(c.env.DB)
  const refreshTokenHash = await hashToken(payload.refresh_token)

  // Find session
  const session = await findSessionByTokenHash(db, refreshTokenHash)
  if (!session) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired refresh token.')
  }

  // Check expiration
  if (new Date(session.expiresAt) < new Date()) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token has expired.')
  }

  // Generate new access token
  const accessToken = await signAccessToken(
    { sub: session.userId, email: session.user?.email },
    c.env.JWT_SECRET
  )

  return sendResource(c, {
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  })
})

auth.post('/logout', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateLogout(payload)

  if (details.length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      details,
    )
  }

  const db = getDb(c.env.DB)
  const refreshTokenHash = await hashToken(payload.refresh_token)

  // Delete session
  await deleteSessionByTokenHash(db, refreshTokenHash)

  return c.body(null, 204)
})

export default auth