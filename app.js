/*!
 * nodeclub - app.js
 */

/**
 * Module dependencies.
 */

var config = require('./config');

if (!config.debug && config.oneapm_key) {
  // 浏览器性能监控
  // 将 oneapm.getBrowserTimingHeader() 写到html模板的 <head> 标签的开头。
  //（如果<head>中存在X-UA-COMPATIBLE HTTP-EQUIV等meta tags，请将语句写到meta tags之后，以便监控的更加精准。）
  // https://www.npmjs.com/package/oneapm
  require('oneapm');
}

// get colors in your node.js console
require('colors');
// Node.js path module
var path = require('path');
// Node静态资源加载器。该模块通过两个步骤配合完成，代码部分根据环境生成标签。
// 上线时，需要调用minify方法进行静态资源的合并和压缩。
var Loader = require('loader');
// Loader Connect是一个适配Connect/Express的静态资源加载器，它基于静态文件的文件扩展名来对源文件进行编译。
var LoaderConnect = require('loader-connect');
var express = require('express');
var session = require('express-session');
var passport = require('passport');
require('./middlewares/mongoose_log'); // 打印 mongodb 查询日志
require('./models');
var GitHubStrategy = require('passport-github').Strategy;
var githubStrategyMiddleware = require('./middlewares/github_strategy');
// 模块化加载所有的route(controllers, middlewares)
var webRouter = require('./web_router');
// api router
var apiRouterV1 = require('./api_router_v1');
var auth = require('./middlewares/auth');
var errorPageMiddleware = require('./middlewares/error_page');
var proxyMiddleware = require('./middlewares/proxy');
// connect-redis is a Redis session store backed by node_redis, and is insanely fast
// https://github.com/tj/connect-redis
var RedisStore = require('connect-redis')(session);
// A modern JavaScript utility library delivering modularity, performance, & extras.
var _ = require('lodash');
// CSRF（Cross-site request forgery跨站请求伪造
var csurf = require('csurf');
var compress = require('compression');
var bodyParser = require('body-parser');
// https://www.npmjs.com/package/busboy
// busboy 
// A streaming parser for HTML form data for node.js
var busboy = require('connect-busboy');
// This middleware is only intended to be used in a development environment, 
// as the full error stack traces and internal details of any object passed to this module will be 
// sent back to the client when an error occurs.
var errorhandler = require('errorhandler');
// CORS-CORS(跨来源资源共享)是一份浏览器技术的规范,
// 提供了Web服务从不同网域传来沙盒脚本的方法,以避开浏览器的同源策略,是JSONP模式的现代版。
var cors = require('cors');
// 记录method,url,ip,time
var requestLog = require('./middlewares/request_log');
// render时记录日志
var renderMiddleware = require('./middlewares/render');
var logger = require('./common/logger');
// helmet 
// help secure Express/Connect apps with various HTTP headers
var helmet = require('helmet');
// bytes 
// Utility to parse a string bytes to bytes and vice-versa
var bytes = require('bytes');

// 静态文件目录
var staticDir = path.join(__dirname, 'public');
// assets
var assets = {};

// 若配置为需要mini化，则加载asset映射
if (config.mini_assets) {
  try {
    assets = require('./assets.json');
  } catch (e) {
    logger.error('You must execute `make build` before start app when mini_assets is true.');
    throw e;
  }
}

// 获取主机名
var urlinfo = require('url').parse(config.host);
config.hostname = urlinfo.hostname || config.host;

var app = express();

// configuration in all env
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');
app.engine('html', require('ejs-mate'));
// 全局layout变量
app.locals._layoutFile = 'layout.html';
app.enable('trust proxy');

// Request logger。请求时间
app.use(requestLog);

if (config.debug) {
  // 渲染时间
  app.use(renderMiddleware.render);
}

// 静态资源
if (config.debug) {
  app.use(LoaderConnect.less(__dirname)); // 测试环境用，编译 .less on the fly
}
// public路径指向static目录
app.use('/public', express.static(staticDir));
app.use('/agent', proxyMiddleware.proxy);

// 通用的中间件
// 浏览器中计算和显示相应时间
app.use(require('response-time')());
// Only let me be framed by people of the same origin:
app.use(helmet.frameguard('sameorigin'));
app.use(bodyParser.json({limit: '1mb'}));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
// Lets you use HTTP verbs such as PUT or DELETE in places where the client doesn't support it.
app.use(require('method-override')());
// signed cookie support by passing a secret string
app.use(require('cookie-parser')(config.session_secret));
app.use(compress());
app.use(session({
  secret: config.session_secret,
  store: new RedisStore({
    port: config.redis_port,
    host: config.redis_host,
  }),
  // Forces the session to be saved back to the session store, 
  // even if the session was never modified during the request. 
  resave: true,
  saveUninitialized: true,
}));

// oauth 中间件
app.use(passport.initialize());

// github oauth
passport.serializeUser(function (user, done) {
  done(null, user);
});
passport.deserializeUser(function (user, done) {
  done(null, user);
});
passport.use(new GitHubStrategy(config.GITHUB_OAUTH, githubStrategyMiddleware));

// custom middleware
app.use(auth.authUser);
app.use(auth.blockUser());

if (!config.debug) {
  app.use(function (req, res, next) {
    if (req.path === '/api' || req.path.indexOf('/api') === -1) {
      csurf()(req, res, next);
      return;
    }
    next();
  });
  app.set('view cache', true);
}

// for debug
// app.get('/err', function (req, res, next) {
//   next(new Error('haha'))
// });

// set static, dynamic helpers
_.extend(app.locals, {
  config: config,
  Loader: Loader,
  assets: assets
});

app.use(errorPageMiddleware.errorPage);
_.extend(app.locals, require('./common/render_helper'));
app.use(function (req, res, next) {
  // pass the csrfToken to the view
  res.locals.csrf = req.csrfToken ? req.csrfToken() : '';
  next();
});

app.use(busboy({
  limits: {
    fileSize: bytes(config.file_limit)
  }
}));

// routes
app.use('/api/v1', cors(), apiRouterV1);
app.use('/', webRouter);

// error handler
if (config.debug) {
  app.use(errorhandler());
} else {
  app.use(function (err, req, res, next) {
    logger.error(err);
    return res.status(500).send('500 status');
  });
}

if (!module.parent) {
  app.listen(config.port, function () {
    logger.info('NodeClub listening on port', config.port);
    logger.info('God bless love....');
    logger.info('You can debug your app with http://' + config.hostname + ':' + config.port);
    logger.info('');
  });
}

module.exports = app;
