const dotenv = require('dotenv');
dotenv.config();
const ApiError = require('../error/ApiError');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { User } = require('../models/models');
const { Op } = require('sequelize');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const generateJwt = (id, email, role, name) => {
    return jwt.sign(
        { id, email, role, name },
        process.env.SECRET_KEY,
        { expiresIn: '24h' }
    );
}

class UserController {
    async registration(req, res, next) {
        const { email, password, role, name } = req.body;
        if (!email || !password || !name) {
            return next(ApiError.badRequest('Некорректный email, password или имя'));
        }
        const candidate = await User.findOne({ where: { email } });
        if (candidate) {
            return next(ApiError.badRequest('Пользователь с таким email уже существует'));
        }
        const hashPassword = await bcrypt.hash(password, 5);
        const user = await User.create({ email, role, password: hashPassword, name });
        const token = generateJwt(user.id, user.email, user.role, user.name);
        return res.json({ token });
    }

    async deleteUser(req, res, next) {
        const userId = req.user.id;

        try {
            const user = await User.findByPk(userId);

            if (!user) {
                return next(ApiError.notFound('Пользователь не найден'));
            }

            await user.destroy();
            return res.sendStatus(204);
        } catch (error) {
            return next(error);
        }
    }

    async login(req, res, next) {
        const { email, password } = req.body;
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return next(ApiError.internal('Пользователь не найден'));
        }
        const comparePassword = bcrypt.compareSync(password, user.password);
        if (!comparePassword) {
            return next(ApiError.internal('Указан неверный пароль'));
        }
        const token = generateJwt(user.id, user.email, user.role, user.name);
        return res.json({ token });
    }

    async getAllUsers(req, res, next) {
        try {
            const users = await User.findAll();
            return res.json(users);
        } catch (error) {
            return next(error);
        }
    }

    async check(req, res, next) {
        try {
            const token = generateJwt(req.user.id, req.user.email, req.user.role, req.user.name);
            return res.json({ token });
        } catch (e) {
            next(ApiError.serverError('Ошибка при проверке токена'));
        }
    }

    async requestPasswordReset(req, res, next) {
        const { email } = req.body;
        //console.log(`Запрос сброса пароля для email: ${email}`);

        const user = await User.findOne({ where: { email } });

        if (!user) {
            //console.log('Пользователь не найден');
            return next(ApiError.badRequest('Пользователь с таким email не найден'));
        }

        const token = jwt.sign(
            { id: user.id, email: user.email }, 
            process.env.SECRET_KEY, 
            { expiresIn: '1h' }
        );

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Сброс пароля',
            html: `
                <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; color: #333; background: #fff8e1; padding: 20px; border: 1px solid #ffcc80; border-radius: 10px;">
            <header style="text-align: center; padding-bottom: 20px;">
    
                <h2 style="color: #ff9800;">Сброс пароля</h2>
            </header>
            <section style="background: #fff3e0; padding: 20px; border-radius: 10px; border: 1px solid #ffe0b2;">
                <p style="font-size: 18px;">Вы получили это письмо, потому что вы (или кто-то другой) запросили сброс пароля для вашего аккаунта.</p>
                <p style="font-size: 16px;">Пожалуйста, нажмите на кнопку ниже или вставьте её в адресную строку вашего браузера, чтобы изменить ваш пароль:</p>
                <a href="http://45.146.165.154:3000/resetPassword/${token}" style="display: inline-block; padding: 15px 25px; margin-top: 20px; margin-bottom: 20px; font-size: 18px; background: #ff9800; color: #ffffff; text-decoration: none; border-radius: 5px;">Сбросить пароль</a>
                <p style="font-size: 14px; color: #888;">Если вы не запрашивали сброс пароля, проигнорируйте это письмо. Ваш пароль останется без изменений.</p>
            </section>
            <footer style="text-align: center; padding-top: 20px;">
                <p style="font-size: 14px; color: #888;">Спасибо,</p>
                <p style="font-size: 14px; color: #888;">Ваша команда поддержки</p>
                <div style="margin-top: 20px;">
                    <a href="https://facebook.com" style="margin: 0 10px;"><img src="https://example.com/facebook-icon.png" alt="Facebook" style="width: 30px;"/></a>
                    <a href="https://twitter.com" style="margin: 0 10px;"><img src="https://example.com/twitter-icon.png" alt="Twitter" style="width: 30px;"/></a>
                    <a href="https://instagram.com" style="margin: 0 10px;"><img src="https://example.com/instagram-icon.png" alt="Instagram" style="width: 30px;"/></a>
                </div>
            </footer>
        </div>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
            //console.log('Письмо отправлено');
            res.status(200).json({ message: 'Email для сброса пароля отправлен' });
        } catch (error) {
            console.error('Ошибка отправки email:', error);
            res.status(500).json({ message: 'Ошибка отправки email', error });
        }
    }

    async resetPassword(req, res, next) {
        const { token, newPassword } = req.body;

        //console.log(`Получен запрос на сброс пароля с токеном: ${token}, новый пароль: ${newPassword}`);
        
        try {
            if (!token || !newPassword) {
                //console.log(`Неккоректные данные: токен - ${token}, новый пароль - ${newPassword}`);
                return next(ApiError.badRequest('Токен и пароль обязательны'));
            }

            let decoded;
            try {
                decoded = jwt.verify(token, process.env.SECRET_KEY);
            } catch (err) {
                //console.log('Токен недействителен или истек');
                return next(ApiError.badRequest('Токен сброса пароля недействителен или истек'));
            }

            const user = await User.findOne({ where: { id: decoded.id, email: decoded.email } });

            if (!user) {
                //console.log('Пользователь не найден');
                return next(ApiError.badRequest('Пользователь не найден'));
            }

            user.password = await bcrypt.hash(newPassword, 5);

            await user.save();
            //console.log('Пароль обновлен');
            res.status(200).json({ message: 'Пароль успешно изменен' });
        } catch (error) {
            console.error(`Ошибка сервера при сбросе пароля: ${error.message}`);
            return next(ApiError.serverError('Ошибка сервера при сбросе пароля'));
        }
    }

    renderResetPasswordPage(req, res) {
        const { token } = req.params;
        res.send(
           `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Reset Password</title>
            </head>
            <body>
                <h1>Сброс пароля</h1>
                <form action="/api/user/resetPassword" method="POST">
                    <input type="hidden" name="token" value="${token}" />
                    <label for="newPassword">Новый пароль:</label>
                    <input type="password" id="newPassword" name="newPassword" required minlength="6" />
                    <button type="submit">Сбросить пароль</button>
                </form>
            </body>
            </html>`
        );
    }


}

module.exports = new UserController();
