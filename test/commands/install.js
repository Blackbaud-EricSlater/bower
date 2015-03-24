var expect = require('expect.js');
var path = require('path');
var helpers = require('../helpers');
var nock = require('nock');
var rimraf = require('rimraf');
var fs = require('../../lib/util/fs');
var tar = require('tar-fs');
var destroy = require('destroy');
var Q = require('q');

describe('bower install', function() {

    var tempDir = new helpers.TempDir();

    var install = helpers.command('install', {
        cwd: tempDir.path
    });

    it('correctly reads arguments', function() {
        expect(install.readOptions(['jquery', 'angular', '-F', '-p', '-S', '-D', '-E']))
            .to.eql([
                ['jquery', 'angular'], {
                    forceLatest: true,
                    production: true,
                    save: true,
                    saveDev: true,
                    saveExact: true
                }
            ]);
    });

    it('correctly reads long arguments', function() {
        expect(install.readOptions([
            'jquery', 'angular',
            '--force-latest', '--production', '--save', '--save-dev', '--save-exact'
        ])).to.eql([
            ['jquery', 'angular'], {
                forceLatest: true,
                production: true,
                save: true,
                saveDev: true,
                saveExact: true
            }
        ]);
    });

    var mainPackage = new helpers.TempDir({
        'bower.json': {
            name: 'package'
        }
    }).prepare();

    var gitPackage = new helpers.TempDir();
    
    gitPackage.prepareGit({
        '1.0.0': {
            'bower.json': {
                name: 'package'
            },
            'version.txt': '1.0.0'
        },
        '1.0.1': {
            'bower.json': {
                name: 'package'
            },
            'version.txt': '1.0.1'
        }
    });

    it('writes to bower.json if --save flag is used', function() {
        mainPackage.prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test'
            }
        });

        return helpers.run(install, [
            [mainPackage.path], {
                save: true
            }
        ]).then(function() {
            expect(tempDir.read('bower.json')).to.contain('dependencies');
        });
    });

    it('writes an exact version number to dependencies in bower.json if --save --save-exact flags are used', function() {
        mainPackage.prepare({
            'bower.json': {
                name: 'package',
                version: '1.2.3'
            }
        });

        tempDir.prepare({
            'bower.json': {
                name: 'test'
            }
        });

        return helpers.run(install, [
            [mainPackage.path], {
                saveExact: true,
                save: true
            }
        ]).then(function() {
            expect(tempDir.readJson('bower.json').dependencies.package).to.equal(mainPackage.path + '#1.2.3');
        });
    });

    it('writes an exact version number to devDependencies in bower.json if --save-dev --save-exact flags are used', function() {
        mainPackage.prepare({
            'bower.json': {
                name: 'package',
                version: '0.1.0'
            }
        });

        tempDir.prepare({
            'bower.json': {
                name: 'test'
            }
        });

        return helpers.run(install, [
            [mainPackage.path], {
                saveExact: true,
                saveDev: true
            }
        ]).then(function() {
            expect(tempDir.readJson('bower.json').devDependencies.package).to.equal(mainPackage.path + '#0.1.0');
        });
    });

    it('reads .bowerrc from cwd', function() {
        mainPackage.prepare({
            foo: 'bar'
        });

        tempDir.prepare({
            '.bowerrc': {
                directory: 'assets'
            },
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: mainPackage.path
                }
            }
        });

        return helpers.run(install).then(function() {
            expect(tempDir.read('assets/package/foo')).to.be('bar');
        });
    });

    it('.bowerrc directory can be an absolute path', function() {
        mainPackage.prepare({
            foo: 'bar'
        });

        tempDir.prepare({
            '.bowerrc': {
                directory: '/tmp/bower-absolute-destination-directory'
            },
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: mainPackage.path
                }
            }
        });

        return helpers.run(install).then(function() {
            expect(require('fs').readFileSync('/tmp/bower-absolute-destination-directory/package/foo', 'utf8').toString()).to.be('bar');
            var deferred = Q.defer();
            rimraf('/tmp/bower-absolute-destination-directory', function(err) {
                if(err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve();
                }
            });
            return deferred;
        });
    });

    it('runs preinstall hook', function() {
        mainPackage.prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: mainPackage.path
                }
            },
            '.bowerrc': {
                scripts: {
                    preinstall: 'node -e \'require("fs").writeFileSync("preinstall.txt", "%")\''
                }
            }
        });

        return helpers.run(install).then(function() {
            expect(tempDir.read('preinstall.txt')).to.be('package');
        });
    });

    it('runs postinstall hook', function() {
        mainPackage.prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: mainPackage.path
                }
            },
            '.bowerrc': {
                scripts: {
                    postinstall: 'node -e \'require("fs").writeFileSync("postinstall.txt", "%")\''
                }
            }
        });

        return helpers.run(install).then(function() {
            expect(tempDir.read('postinstall.txt')).to.be('package');
        });
    });

    // To be discussed, but that's the implementation now
    it('does not run hooks if nothing is installed', function() {
        tempDir.prepare({
            'bower.json': {
                name: 'test'
            },
            '.bowerrc': {
                scripts: {
                    postinstall: 'node -e \'require("fs").writeFileSync("hooks.txt", "%")\'',
                    preinstall: 'node -e \'require("fs").writeFileSync("hooks.txt", "%")\''
                }
            }
        });

        return helpers.run(install).then(function() {
            expect(tempDir.exists('hooks.txt')).to.be(false);
        });
    });

    it('runs postinstall after bower.json is written', function() {
        mainPackage.prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test'
            },
            '.bowerrc': {
                scripts: {
                    postinstall: 'node -e \'var fs = require("fs"); fs.writeFileSync("hook.txt", fs.readFileSync("bower.json"));\''
                }
            }
        });

        return helpers.run(install, [
            [mainPackage.path], {
                save: true
            }
        ]).then(function() {
            expect(tempDir.read('hook.txt')).to.contain('dependencies');
        });
    });

    it('display the output of hook scripts', function(next) {
        mainPackage.prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: mainPackage.path
                }
            },
            '.bowerrc': {
                scripts: {
                    postinstall: 'node -e \'process.stdout.write("foobar")\''
                }
            }
        });
        var lastAction = null;

        helpers.run(install).logger.intercept(function(log) {
            if (log.level === 'action') {
                lastAction = log;
            }
        }).on('end', function() {
            expect(lastAction.message).to.be('foobar');
            next();
        });
    });

    it('skips components not installed by bower', function() {
        mainPackage.prepare({
            '.git': {} //Make a dummy file instead of using slower gitPrepare()
        });

        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: mainPackage.path
                }
            }
        });

        return helpers.run(install).then(function() {
            var packageFiles = fs.readdirSync(mainPackage.path);
            //presence of .git file implies folder was not overwritten
            expect(packageFiles).to.contain('.git');
        });
    });

    it('works for git repositories', function () {
        gitPackage.prepareGit({
            '1.0.0': {
                'bower.json': {
                    name: 'package'
                },
                'version.txt': '1.0.0'
            },
            '1.0.1': {
                'bower.json': {
                    name: 'package'
                },
                'version.txt': '1.0.1'
            }
        });

        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: gitPackage.path + '#1.0.0'
                }
            }
        });

        return helpers.run(install).then(function() {
            expect(tempDir.read('bower_components/package/version.txt')).to.contain('1.0.0');
        });
    });

    it('works for dependencies that point to tar files', function() {
        var packageDir = path.join(__dirname, '../assets/package-tar.tar');
        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    package: packageDir
                }
            }
        });

        return helpers.run(install).then(function() {
            expect(tempDir.read('bower_components/package/index.txt')).to.contain('1.0.0');
        });
    });

    it('does not install ignored dependencies', function() {
        mainPackage.prepare();
        var package2 = new helpers.TempDir({
            'bower.json': {
                name: 'package2',
            }
        }).prepare();

        var package3 = new helpers.TempDir({
            'bower.json': {
                name: 'package3',
                dependencies: {
                    package2: package2.path,
                    package: mainPackage.path,
                }
            }
        }).prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test_tw',
                dependencies: {
                    package3: package3.path
                }
            },
            '.bowerrc': {
                ignoredDependencies: ['package']
            }
        });

        return helpers.run(install).then(function() {
            expect(tempDir.exists('bower_components/package')).to.be(false);
            expect(tempDir.exists('bower_components/package2')).to.be(true);
        });
    });

    it('does not install ignored dependencies if run multiple times', function() {
        mainPackage.prepare();
        var package2 = new helpers.TempDir({
            'bower.json': {
                name: 'package2',
            }
        }).prepare();

        var package3 = new helpers.TempDir({
            'bower.json': {
                name: 'package3',
                dependencies: {
                    package2: package2.path,
                    package: mainPackage.path,
                }
            }
        }).prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test_tw',
                dependencies: {
                    package3: package3.path
                }
            },
            '.bowerrc': {
                ignoredDependencies: ['package']
            }
        });
        return helpers.run(install).then(function() {
            return helpers.run(install).then(function() {
                expect(tempDir.exists('bower_components/package')).to.be(false);
                expect(tempDir.exists('bower_components/package2')).to.be(true);
            });
        });
    });

    it('recognizes proxy option in config', function(done) {
        this.timeout(10000);

        tempDir.prepare({
            'bower.json': {
                name: 'test_tw',
                dependencies: {
                    pure: 'http://github.com/yahoo/pure/archive/v0.6.0.tar.gz'
                }
            }
        });

        var install = helpers.command('install', {
            cwd: tempDir.path
        });

        nock('http://dummy.local')
            .get('http://github.com/yahoo/pure/archive/v0.6.0.tar.gz')
            .reply(500);

        return helpers.run(install, [
          undefined,
          undefined,
          { proxy: 'http://dummy.local/' }
        ])
        .fail(function(error) {
            expect(error.message).to.equal('Status code of 500');
            done();
        });
    });

    it('errors if the components directory is not a directory', function() {
        tempDir.prepare({
            '.bowerrc': {
                directory: '.bowerrc'
            }
        });

        return helpers.run(install).fail(function(error) {
            expect(error.code).to.equal('ENOTDIR');
        });
    });

    it('works if the package is a compressed single directory containing another directory with the same name', function() {
        var mainPackageBaseName = path.basename(mainPackage.path);
        var parentDir = path.dirname(mainPackage.path);

        // Setup the main package with a directory with the same name
        var mainPackageFiles = {};
        mainPackageFiles[mainPackageBaseName + '/test.js'] = 'test';
        mainPackage.prepare(mainPackageFiles);

        // Create an archive containing the main package
        var archiveDeferred = Q.defer();
        var archivePath = path.join(parentDir, mainPackageBaseName + '.tar');
        var stream = tar.pack(parentDir, { entries: [mainPackageBaseName] });
        stream
            .pipe(fs.createWriteStream(archivePath))
            .on('finish', function(result) {
                destroy(stream);
                archiveDeferred.resolve(result);
            });

        //// Attempt to install the package from the archive
        tempDir.prepare({
            'bower.json': {
                name: 'test'
            }
        });

        return archiveDeferred.promise
        .then(function() {
            return helpers.run(install, [[archivePath]]);
        })
        .then(function() {
            expect(tempDir.read(path.join('bower_components', 'package', mainPackageBaseName, 'test.js'))).to.contain('test');
        });
    });

    it('works if the package is an archive containing a file with an identical name', function() {
        var parentDir = path.dirname(mainPackage.path);

        mainPackage.prepare({
            'package.tar': 'test'
        });

        var archiveDeferred = Q.defer();
        var archivePath = path.join(parentDir, 'package.tar');
        var stream = tar.pack(mainPackage.path);
        stream
            .pipe(fs.createWriteStream(archivePath))
            .on('finish', function(result) {
                destroy(stream);
                archiveDeferred.resolve(result);
            });


        tempDir.prepare({
            'bower.json': {
                name: 'test'
            }
        });

        return archiveDeferred.promise
        .then(function() {
            return helpers.run(install, [[archivePath]]);
        })
        .then(function() {
            expect(tempDir.read(path.join('bower_components', 'package', 'package.tar'))).to.contain('test');
        });
    });

    it('generates a lockFile', function () {
        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.0'
                }
            }
        });

        return helpers.run(install).then(function() {
            var lockFileContents = tempDir.readJson('bower.lock');
            expect(lockFileContents).to.not.be(undefined);
            expect(lockFileContents).to.not.eql({});
            lockFile = lockFileContents;
        });
    });

    it('requires a lockFile when production', function (next) {
        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.0'
                }
            }
        });

        return helpers.run(install, [[], {production: true}]).then(function() {
            next(new Error('Error not thrown as expected'));
        }, function() {
            next();
        });
    });

    it('installs from lockFile when exists', function (next) {
        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.0'
                }
            },
            'bower.lock': lockFile
        });

        return helpers.run(install).then(function() {
            next();
        }, function() {
            next();
        });
    });

    it('error when tampering with version number', function (next) {
        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.1'
                }
            },
            'bower.lock': lockFile
        });

        return helpers.run(install).then(function() {
            next(new Error('Error not thrown as expected'));
        }, function() {
            next();
        });
    });

    it('new dependencies added in bower.json are installed', function () {
        package.prepare();

        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.0',
                    package: '0.1.1'
                }
            },
            'bower.lock': lockFile
        });

        return helpers.run(install).then(function() {
            expect(tempDir.read('bower_components/package/bower.json')).to.contain('"version": "0.1.1"');
            var lockFileContents = tempDir.read('bower.lock');
            expect(lockFileContents).to.contain('"package"');
            expect(lockFileContents).to.contain('"_release": "0.1.1"');
            lockFile = lockFileContents;
        });
    });

    it('should install from lock file', function () {
        package.prepare();

        // Modify the lock file to match
        // test bower.json to test that
        // even though a newer version is available
        // the lock file is installing what it has
        lockFile = JSON.parse(lockFile);
        lockFile.dependencies.package.endpoint.target = '~0.1.0';

        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.0',
                    package: '~0.1.0'
                }
            },
            'bower.lock': lockFile
        });

        return helpers.run(install).then(function() {
            expect(tempDir.read('bower_components/package/bower.json')).to.contain('"version": "0.1.1"');
            expect(tempDir.read('bower.lock')).to.contain('"package"');
            expect(tempDir.read('bower.lock')).to.contain('"_release": "0.1.1"');
        });
    });

    it('should install package when specifying package but not be in lockFile', function () {
        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.0',
                    package: '~0.1.0'
                }
            },
            'bower.lock': lockFile
        });

        return helpers.run(install, [['angular']]).then(function() {
            expect(tempDir.read('bower_components/angular/bower.json')).to.contain('"version": "1.3.15"');
            expect(tempDir.read('bower.lock')).to.not.contain('"angular"');
        });
    });

    var bowerJson = null;

    it('should install package when specifying package and be in lockFile with save argument', function () {
        tempDir.prepare({
            'bower.json': {
                name: 'test',
                dependencies: {
                    packageGit: gitPackage.path + '#1.0.0',
                    package: '~0.1.0'
                }
            },
            'bower.lock': lockFile
        });

        return helpers.run(install, [['angular'], {save: true}]).then(function() {
            expect(tempDir.read('bower_components/angular/bower.json')).to.contain('"version": "1.3.15"');
            expect(tempDir.read('bower.lock')).to.contain('"angular"');
            expect(tempDir.read('bower.json')).to.contain('"angular"');
            bowerJson = tempDir.read('bower.json');
            lockFile = tempDir.read('bower.lock');
        });
    });

    it('should install package when specifying package and be in lockFile with save-dev argument', function () {
        tempDir.prepare({
            'bower.json': bowerJson,
            'bower.lock': lockFile
        });

        return helpers.run(install, [['jquery'], {saveDev: true}]).then(function() {
            bowerJson = tempDir.read('bower.json');
            console.log(bowerJson);
            expect(tempDir.read('bower.lock')).to.contain('"jquery"');
            lockFile = tempDir.read('bower.lock');
        });
    });
});
