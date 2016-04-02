# 查找test文件夹下面所有的.text.js后缀的文件存入TESTS
TESTS = $(shell find test -type f -name "*.test.js")
TEST_TIMEOUT = 10000
MOCHA_REPORTER = spec
# NPM_REGISTRY = "--registry=http://registry.npm.taobao.org"
NPM_REGISTRY = ""


all: test

# 执行npm包安装命令
install:
	@npm install $(NPM_REGISTRY)

pretest:
	# 不存在配置文件则从default复制
	@if ! test -f config.js; then \
		cp config.default.js config.js; \
	fi
	# 不存在upload目录则创建
	@if ! test -d public/upload; then \
		mkdir public/upload; \
	fi

# 执行mocha运行测试用例
test: install pretest
	@NODE_ENV=test ./node_modules/mocha/bin/mocha \
		--reporter $(MOCHA_REPORTER) \
		-r should \
		-r test/env \
		--timeout $(TEST_TIMEOUT) \
		$(TESTS)

# 在同个进程中执行测试和代码覆盖率检查
# http://www.ruanyifeng.com/blog/2015/06/istanbul.html
test-cov cov: install pretest
	@NODE_ENV=test node \
		node_modules/.bin/istanbul cover --preserve-comments \
		./node_modules/.bin/_mocha \
		-- \
		-r should \
		-r test/env \
		--reporter $(MOCHA_REPORTER) \
		--timeout $(TEST_TIMEOUT) \
		$(TESTS)

# https://github.com/JacksonTian/loader-builder
build:
	@./node_modules/loader-builder/bin/builder views .

run:
	@node app.js

# Linux nohup(进程后台执行)
# PM2 allows to restart an application based on a memory limit.
# Use >> to append
# File descriptor 1 is the standard output (stdout).
# File descriptor 2 is the standard error (stderr).
# 2>1 may look like a good way to redirect stderr to stdout. 
# However, it will actually be interpreted as "redirect stderr to a file named 1". 
# & indicates that what follows is a file descriptor and not a filename.
# 把stderr流指向stdout，并都写入cnode.log
# -i 0: 
# Will start maximum processes with LB depending on available CPUs
start: install build
	@NODE_ENV=production nohup ./node_modules/.bin/pm2 start app.js -i 0 --name "cnode" --max-memory-restart 400M >> cnode.log 2>&1 &

restart: install build
	@NODE_ENV=production nohup ./node_modules/.bin/pm2 restart "cnode" >> cnode.log 2>&1 &

# 强制别名（伪文件）
.PHONY: install test cov test-cov build run start restart
