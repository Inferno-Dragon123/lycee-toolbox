import nodemailer from 'nodemailer';

const unavailable = () => Object.assign(new Error('验证码邮件尚未配置，请稍后再试'), { status: 503, expose: true });
let transport;

export function smtpConfigured(env = process.env) {
    return Boolean(env.SMTP_HOST && env.SMTP_FROM && env.SMTP_USER && env.SMTP_PASS);
}

export function smtpOptions(env = process.env) {
    if (!smtpConfigured(env)) throw unavailable();
    const port = Number(env.SMTP_PORT || 465);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw unavailable();
    const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
    return { host: env.SMTP_HOST, port, secure, requireTLS: !secure,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        logger: false, debug: false, tls: { rejectUnauthorized: true } };
}

export async function sendLoginOtp({ email, otp, type }, env = process.env) {
    if (type !== 'sign-in') throw Object.assign(new Error('不支持的验证码类型'), { status: 400 });
    if (!transport) transport = nodemailer.createTransport(smtpOptions(env));
    try {
        await transport.sendMail({ from: env.SMTP_FROM, to: email,
            subject: 'Lycee 工具箱登录验证码',
            text: `你的 Lycee 工具箱登录验证码是：${otp}\n\n验证码 5 分钟内有效。如非本人操作，请忽略此邮件。`,
            disableFileAccess: true, disableUrlAccess: true });
    } catch {
        // Never include SMTP responses, recipients, credentials, or OTPs in logs.
        throw Object.assign(new Error('验证码邮件发送失败，请稍后再试'), { status: 503, expose: true });
    }
}

export function closeAuthMail() { transport?.close(); transport = undefined; }
