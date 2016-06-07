var signature = require('cookie-signature'),
    Redis = require('ioredis'),
    _ = require('underscore'),

    uuid = require('./lib/uuid'),

    // session key
    redisSessionKey = "rsessionid";

module.exports = RedisSession;

/**
 * redis-session缓存中间件
 * @Author   fisher<wangjiang.fly.1989@163.com>
 * @DateTime 2016-03-25T14:15:59+0800
 * @param {Object} options [description]
 * options.expires  缓存过期时间，单位毫秒(ms), 默认值30 * 60 * 1000（半小时）
 * options.redisCluster redis cluster对象，若不配置该字段，则redis cluster对象则由options.redisConf配置生成
 * options.redisConf: {
 *   redisStore: '192.168.1.1:6479,192.168.1.1:6480,192.168.1.1:6481,192.168.1.1:6482,192.168.1.1:6483,192.168.1.1:6484,192.168.1.1:6485,192.168.1.1:6486,192.168.1.1:6487'
 * }
 * 
 */
function RedisSession (options) {

    var opts = options || {};

    // 默认缓存时间30分钟
    var expires = opts.expires || 30 * 60,
        secret = opts.secret;

    opts.redisCluster = opts.redisCluster || getRedisClusterObj(opts.redisConf);


    if (!opts.redisCluster) {
        throw Error('redis3x-session middleware args error, options.redisCluster is undefined!');
    }

    return function _redisSession3x (req, res, next) {

        // 重写writeHead， 在响应时写cookie
        var writeHead = res.writeHead;
        res.writeHead = function () {
            // 支持针对单独session定制过期时间
            // 保存cookie及redis缓存
            // 更新cookie对象
            res.cookie(redisSessionKey, signature.sign(req.rSession.sessionId, secret), {
                //maxAge: 0, //expires * 1000,
                httpOnly: true
            });

            return writeHead.apply(this, arguments);
        };
        

        // 同步方式，依赖redis响应结果然后响应请求结果
        var _end = res.end;
        res.end = function() {
            var args = arguments;

            // 支持针对单独session定制过期时间
            // 保存cookie及redis缓存
            req.rSession.save(res, opts.redisCluster, secret, req.rSession.expires || expires, function() {
                return _end.apply(res, args);
            });
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
 * 保存RSession实例到Redis
 * @return {[type]} [description]
 */
RSession.prototype.save = function (res, redisCluster, secret, expires, cb) {
    var ctx = this._ctx,
        val = RSession.serialize(this);

    var sessionId = this.sessionId;


    // console.log('更新cookie: sessionId=', sessionId, ' cookiesignedvalue=', signature.sign(sessionId, secret));
    // console.log('更新redis: sessionId=', sessionId, ' val=', val);

    // 只在值有变化时更新redis缓存内容
    if (ctx._val != val) {
        // 设置redis缓存
        redisCluster.set(sessionId, val, function(err, re) {
            if (err) {
                throw Error(err);
            }
            if (cb) {
                cb();
            }
        });
    } else {
        if (cb) {
            cb();
        }
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
    return 'redis3x-session-id:' + uuid.create();
}

/**
 * generate redis cluster object
 * @Author   fisher<wangjiang.fly.1989@163.com>
 * @DateTime 2016-03-25T14:35:35+0800
 * @param    {Object}                           conf [description]
 *    conf.redisStore  String  redis配置: "192.168.1.1:6479,192.168.1.1:6480,192.168.1.1:6481,192.168.1.1:6482,192.168.1.1:6483,192.168.1.1:6484,192.168.1.1:6485,192.168.1.1:6486,192.168.1.1:6487",
 * @return   {Redis.Cluster}                                [description]
 */
function getRedisClusterObj(conf) {
    var redisOption = [];
    if ('string' === typeof(conf.redisStore)) {
        var splits = conf.redisStore.split(',');

        splits.forEach(function (cf) {
            var hostPort = cf.split(':');
            redisOption.push({
                host: hostPort[0].trim(),
                port: hostPort[1].trim()
            });
        });
    } else {
        redisOption = conf.store || [];
    }

    console.log('redis config: ', redisOption);

    var redisCluster = new Redis.Cluster(redisOption);

    // 监听redis事件
    _.each(['connect', 'ready', 'reconnecting', 'end', 'close', 'error'], function (e) {
        redisCluster.on(e, function () {
            console.log('redis status: ' + e);
        });
    });

    return redisCluster;
}

