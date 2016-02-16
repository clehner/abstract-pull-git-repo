var testRepoData = require('./repo')
var pull = require('pull-stream')
var multicb = require('multicb')

function objectEncoding(obj) {
  return obj.type == 'tree' ? 'hex' : 'utf8'
}

function getUpdate(num) {
  var update = testRepoData.updates[num]
  return {
    refs: pull.values(update.refs),
    objects: pull(
      pull.values(update.objects),
      pull.map(function (hash) {
        var obj = testRepoData.objects[hash]
        if (!obj) throw new Error('Missing object ' + hash)
        var buf = new Buffer(obj.data, objectEncoding(obj))
        return {
          type: obj.type,
          length: obj.length,
          read: pull.once(buf)
        }
      })
    )
  }
}

exports.repo = function (test, repo) {

  test('empty repo has no refs', function (t) {
    var readRef = repo.refs()
    readRef(null, function next(end, ref) {
      t.equals(end, true, 'no refs')
      t.end()
    })
  })

  test('push updates to repo', function (t) {
    testPushCommit0(t, repo, repo)
    testPushCommit1(t, repo, repo)
    testPushCommit2(t, repo, repo)
    testPushTag(t, repo, repo)
    testPushTagAgain(t, repo, repo)
    testDeleteTag(t, repo, repo)
  })
}

exports.repos = function (test, repoA, repoB) {
  test('push updates between repos', function (t) {
    testPushCommit0(t, repoA, repoB)
    testPushCommit1(t, repoA, repoB)
    testPushCommit2(t, repoA, repoB)
    testPushTag(t, repoA, repoB)
    testPushTagAgain(t, repoA, repoB)
    testDeleteTag(t, repoA, repoB)
  })
}

function testPushCommit0(t, repoA, repoB) {
  t.test('push initial commit with a file', function (t) {
    testUpdate(t, repoA, repoB, 0)
    testRefs(t, repoA, repoB, {
      'refs/heads/master': '9a385c1d6b48b7f472ac507a3ec08263358e9804'
    })
  })
}

function testPushCommit1(t, repoA, repoB) {
  t.test('push a commit updating some files', function (t) {
    testUpdate(t, repoA, repoB, 1)
    testRefs(t, repoA, repoB, {
      'refs/heads/master': '4afea1721eed6ab0de651f73f767c64406aeaeae'
    })
  })
}

function testPushCommit2(t, repoA, repoB) {
  t.test('push another commit and stuff', function (t) {
    testUpdate(t, repoA, repoB, 2)
    testRefs(t, repoA, repoB, {
      'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5'
    })
  })
}

function testPushTag(t, repoA, repoB) {
  t.test('push a tag', function (t) {
    testUpdate(t, repoA, repoB, 3)
    testRefs(t, repoA, repoB, {
      'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5',
      'refs/tags/v1.0.0': '6a63b117b09c5c82cb1085cbf525da8f94f5bdf8'
    })
  })
}

function testPushTagAgain(t, repoA, repoB) {
  t.test('push tag again', function (t) {
    var update = getUpdate(3)
    repoA.update(update.refs, update.objects, function (err) {
      t.ok(err, 'pushing tag again fails')
      testRefs(t, repoA, repoB, {
        'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5',
        'refs/tags/v1.0.0': '6a63b117b09c5c82cb1085cbf525da8f94f5bdf8'
      })
    })
  })
}

function testDeleteTag(t, repoA, repoB) {
  t.test('delete tag', function (t) {
    var update = getUpdate(3)
    repoA.update(pull.once({
      name: 'refs/tags/v1.0.0',
      old: '6a63b117b09c5c82cb1085cbf525da8f94f5bdf8',
      new: null
    }), null, function (err) {
      t.error(err, 'deleted tag')
      testRefs(t, repoA, repoB, {
        'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5',
      }, 'check refs', 'tag was deleted')
    })
  })
}

function repoHasObjects(repo, hashes, cb) {
  var done = multicb({pluck: 1})
  hashes.forEach(function (hash) {
    repo.hasObject(hash, done())
  })
  done(cb)
}

function repoGetObjects(repo, hashes, cb) {
  var done = multicb({pluck: 1})
  hashes.forEach(function (hash) {
    repo.getObject(hash, done())
  })
  done(cb)
}

function testUpdate(t, repoA, repoB, i) {
  var hashes = testRepoData.updates[i].objects

  t.test('repo A does not have the objects before push', function (t) {
    testNoObjects(t, repoA, hashes)
  })
  t.test('repo B does not have the objects before push', function (t) {
    testNoObjects(t, repoB, hashes)
  })

  t.test('push objects and ref update', function (t) {
    var update = getUpdate(i)
    repoA.update(update.refs, update.objects, function (err) {
      t.error(err, 'pushed update')
      t.test('objects are added', function (t) {
        testObjectsAdded(t, repoA, hashes)
        testObjectsAdded(t, repoB, hashes)
        t.end()
      })
    })
  })
}

function testNoObjects(t, repo, hashes) {
  repoHasObjects(repo, hashes, function (err, haves) {
    t.error(err, 'have objects')
    if (!haves) {
      t.fail('hasObject failed')
    } else {
      t.notOk(haves.some(Boolean), 'objects not present before push')
      t.equals(haves.length, hashes.length, 'not any of the objects')
    }

    repoGetObjects(repo, hashes, function (err, objects) {
      t.error(err, 'got objects')
      if (!objects) {
        t.fail('getObject failed')
      } else {
        t.notOk(haves.some(Boolean), 'objects not present before push')
        t.equals(haves.length, hashes.length, 'not any of the objects')
        t.end()
      }
    })
  })
}

function testObjectsAdded(t, repo, hashes) {
  repoHasObjects(repo, hashes, function (err, haves) {
    if (!haves) {
      t.fail('hasObject failed')
    } else {
      t.ok(haves.every(Boolean), 'got the objects')
      t.equals(haves.length, hashes.length, 'all the objects')
    }

    t.test('object contents can be retrieved', function (t) {
      testObjectsRetrievable(t, repo, hashes)
      t.end()
    })
  })
}

function testObjectsRetrievable(t, repo, hashes) {
  var done = multicb({pluck: 1})
  hashes.forEach(function (hash) {
    var cb = done()
    repo.getObject(hash, function (err, obj) {
      t.error(err, 'got object')
      if (!obj) {
        t.fail('Missing object ' + hash)
        return cb()
      }
      pull(
        obj.read,
        pull.collect(function (err, bufs) {
          t.error(err, 'got object data')
          var buf = Buffer.concat(bufs)
          var expected = testRepoData.objects[hash]
          t.deepEquals({
            type: obj.type,
            length: obj.length,
            data: buf.toString(objectEncoding(obj))
          }, expected, 'got ' + expected.type + ' ' + hash)
          cb()
        })
      )
    })
  })
}

function testRefs(t, repoA, repoB, refs, msg, equalsMsg) {
  testRefs1(t, repoA, refs, msg || 'refs are updated in repo A', equalsMsg)
  testRefs1(t, repoB, refs, msg || 'refs are updated in repo B', equalsMsg)
}

function testRefs1(t, repo, refsExpected, msg, equalsMsg) {
  t.test(msg, function (t) {
    pull(
      repo.refs(),
      pull.collect(function (err, refsArr) {
        t.error(err, 'got refs')
        var refs = {}
        refsArr.forEach(function (ref) {
          refs[ref.name] = ref.hash
        })
        t.deepEquals(refs, refsExpected, equalsMsg || 'refs updated')
        t.end()
      })
    )
  })
}
