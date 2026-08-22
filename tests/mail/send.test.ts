import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { consoleTransport, resendTransport } from '@/lib/mail/transport'
import { sendVerificationEmail } from '@/lib/mail/send'

const MESSAGE = { to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>' }

describe('consoleTransport', () => {
  it('prints the message, link included, so an agent can drive the flow locally', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await consoleTransport.send({ ...MESSAGE, text: 'open https://x.test/verify/tok' })
    const printed = log.mock.calls.flat().join('\n')
    expect(printed).toContain('a@example.com')
    expect(printed).toContain('https://x.test/verify/tok')
    log.mockRestore()
  })
})

describe('resendTransport', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs to the Resend API with a bearer key and the from address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    await resendTransport('re_key', 'Quizlet <no@x.test>').send(MESSAGE)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_key')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ from: 'Quizlet <no@x.test>', to: 'a@example.com', subject: 's' })
  })

  it('throws on a non-ok response, so send.ts is the one that decides to swallow it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'bad domain' }),
    )
    await expect(resendTransport('re_key', 'f@x.test').send(MESSAGE)).rejects.toThrow()
  })
})

describe('sendVerificationEmail', () => {
  const OLD = { ...process.env }
  afterEach(() => {
    process.env = { ...OLD }
    vi.restoreAllMocks()
  })

  it('NEVER throws, even when the transport blows up', async () => {
    // It runs inside after(), where an exception is unhandled and silently
    // kills the callback. Swallowing here is deliberate; the cost is that a
    // broken mail configuration is quiet.
    process.env.RESEND_API_KEY = 're_key'
    process.env.MAIL_FROM = 'Quizlet <no@x.test>'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network is down')))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendVerificationEmail('a@example.com', 'tok')).resolves.toBeUndefined()
    expect(err.mock.calls.flat().join(' ')).toContain('[mail]')
  })

  it('uses the console transport when RESEND_API_KEY is absent', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendVerificationEmail('a@example.com', 'tok')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('/verify/tok')
  })
})
