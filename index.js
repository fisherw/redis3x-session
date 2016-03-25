var signature = require('cookie-signature'),
    _ = require('underscore'),

    uuid = require('./lib/uuid'),

    // session key
    redisSessionKey = "rsessionid";

module.exports = RedisSession;

/**
 * redis-session缓存中间件
 * @Author   fisher<wangjiang.fly.1989@163.com>
 * @DateTime 2016-03-25T14:15:59+0800
 * @param {Object} opts [description]
 * opts.expires  缓存过期时间，单位秒(s), 默认值30 * 60（半小时）
 */
function RedisSession (options) {

    var opts = options || {};

    // 默认缓存时间30分钟
    var expires = opts.expires || 30 * 60,
        secret = opts.secret;


    if (!options.redisCluster) {
        throw Error('redis3x-session middleware args error, options.redisCluster is need!');
    }

    return function _redisSession3x (req, res, next) {

        // 重写writeHead， 在响应时写cookie及更新redis缓存
        var writeHead = res.writeHead;
        res.writeHead = function () {
            // 支持针对单独session定制过期时间
            // 保存cookie及redis缓存
            req.rSession.save(res, options.redisCluster, secret, req.rSession.expires || expires);

            return writeHead.apply(this, arguments);
        };

        // 由cookie-parser中间件生成，若自己实现，则不需依赖cookie-parser
        var cookies = req.cookies;

        if (undefined === req.cookies) {
            throw Error('redis3x-session need cookie-parser middleware');
        }

        var signedSessionId = cookies[redisSessionKey],
            sessionId;

        // 可由cookie-parser传入带入到req.secret中
        secret = req.secret || secret;

        // 签名验证及解签
        if (signedSessionId) {
            sessionId = signature.unsign(signedSessionId, secret);
        }

        if (!sessionId) {
            req.rSession = RSession.create(req, {
                // expire: (new Date()).getTime() + expires * 1000
            });

            next();
        } else {
            options.redisCluster.get(sessionId, function (err, sessionStr) {
                var rSessoin;

                // 读到缓存
                if (sessionStr) {
                    try {
                        rSession = RSession.deserialize(req, sessionStr);
                    } catch (error) {
                        console.error(error);
                        rSession = undefined;
                    }

                    // 缓存反序列化成功
                    if (rSession) {
                        req.rSession = rSession;

                    // 反序列化失败时
                    } else {
                        req.rSession = RSession.create(req, {
                            // expire: (new Date()).getTime() + expires * 1000,
                            sessionId: sessionId
                        });
                    }
                // 读不到缓存
                } else {
                    req.rSession = RSession.create(req, {
                        // expire: (new Date()).getTime() + expires * 1000,
                        sessionId: sessionId
                    });
                }

                next();
            });
        }
    };
}

/**
 * redis session 类定义
 * @param {Context} ctx 上下文对象（sessionContext)
 * @param {Object} options session存储的值
 */
function RSession (ctx, options) {
    Object.defineProperty(this, '_ctx', {
        value: ctx
    });

    if (options) {
        for (var key in options) {
            this[key] = options[key];
        }
    }

    // 生成ressionid 用户唯一标识
    // 存在sessionId，则不进行更新
    if (!this.sessionId) {
        this.sessionId = generateId();
    }
}

/**
 * 创建RSession实例
 * @param  {Context} req 上下文
 * @param  {Object} obj 实例数据
 * @return {RSession}
 */
RSession.create = function (req, obj) {
    var ctx = new RSessionContext(req);

    return new RSession(ctx, obj);
};

/**
 * 序列化RSession对象
 * @param  {RSession} rs
 * @return {String}    rs序列化后的字符串
 */
RSession.serialize = function (rs) {
    return encode(rs);
};

RSession.deserialize = function (req, str) {
    var ctx = new RSessionContext(req),
        obj = decode(str);

    // 标识非新建（由反序列化得到）
    ctx._new = false;

    // 存放RSession序列化串
    ctx._val = str;

    return new RSession(ctx, obj);
};

/**
 * 保存RSession实例
 * 分两步操作：
 * 1.设置RSession实例对应的cookie，作为用户标识
 * 2.保存RSession实例到Redis
 * @return {[type]} [description]
 */
RSession.prototype.save = function (res, redisCluster, secret, expires) {
    var ctx = this._ctx,
        val = RSession.serialize(this);

    var sessionId = this.sessionId;

    // 更新cookie对象
    res.cookie(redisSessionKey, signature.sign(sessionId, secret), {
        //maxAge: 0, //expires * 1000,
        httpOnly: true
    });

    if (ctx._val != val) {
        // 设置redis缓存
        redisCluster.set(sessionId, val);
    }

    // 设置redis缓存时间
    redisCluster.expire(sessionId, expires);
};

/**
 * RSessionContext类封装
 * @param {Context} req ctx对象
 */
function RSessionContext(req) {
    this.req = req;
    this_new = true;
    this._val = undefined;
}

/**
 * 解码base64格式字符串为对象
 * @param  {[type]} string [description]
 * @return {[type]}        [description]
 */
function decode(string) {
  var body = new Buffer(string, 'base64').toString('utf8');
  return JSON.parse(body);
}

/**
 * 将对象转化成base64编码的json字符串
 * @param  {[type]} obj [description]
 * @return {[type]}      [description]
 */
function encode(obj) {
  var str = JSON.stringify(obj);
  return new Buffer(str).toString('base64');
}

/**
 * 生成唯一的标识串
 * @return {[type]} [description]
 */
function generateId () {
    return 'mdwrsid:' + uuid.create();
}

