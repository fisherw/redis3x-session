# redis3x-session
基于redis缓存的Express服务端session中间件, 使用它可以在单机或多集群部署服务的条件下，使用session建立与客户端的联系，并为客户端用户存储重要数据，保证各节点session数据一致。

该中间件使用分布式集群的redis（基于redis3.x版本）客户端（使用ioredis），数据在某redis节点挂掉后其它redis节点仍能正常服务，并选举出新的主节点，有效保证session数据正常存取。

# 示例

##使用自定义redis cluster对象
```javascript
var express = require('express'),
    app = express(),
    redis3xSession = require('redis3x-session');

// 这里使用redis插件为例(使用默认选项创建实例，具体可参考redis插件)
var redis = require("redis"),
    redisCluster = redis.createClient();

// redis session缓存服务开启
app.use(redis3xSession({
    redisCluster: redisCluster,
    expires: 30 * 60
}));
```



##使用中间件内置分布式集群redis客户端（具体使用请参考ioredis）创建cluster
```javascript
var express = require('express'),
    app = express(),
    redis3xSession = require('redis3x-session');

// redis session缓存服务开启
app.use(redis3xSession({
    redisConf: {
        redisStore: '192.168.1.1:6479,192.168.1.1:6480,192.168.1.1:6481,192.168.1.1:6482,192.168.1.1:6483,192.168.1.1:6484,192.168.1.1:6485,192.168.1.1:6486,192.168.1.1:6487'
    },
    expires: 30 * 60
}));
```


#使用session存取数据
##存数据
```javascript
req.rSession.userid = '124242876';
req.rSession.user = {name: 'fisher', id: '22222'};
```

##取数据
```javascript
var userid = req.rSession.userid;
```

##设置客户session过期时间(若不设置，则以中间件配置的expire为过期时间，单位ms(毫秒))
```javascript
req.rSession.expire = 10 * 60;
```




