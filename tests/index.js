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

module.exports = function (test, createRepo) {

  test('create repo', function (t) {
    var repo = createRepo()
    t.ok(repo, 'created repo')
    t.end()
  })

  test('empty repo has no refs', function (t) {
    var readRef = createRepo().refs()
    readRef(null, function next(end, ref) {
      t.equals(end, true, 'no refs')
      t.end()
    })
  })

  test('empty repo does not have dummy object', function (t) {
    createRepo().hasObject('00000000000000000000', function (err, has) {
      t.error(err, 'checked for object')
      t.notOk(has, 'object not present')
      t.end()
    })
  })

  test('push updates to repo', function (t) {
    var repo = createRepo()
    testPushCommit0(t, repo)
    testPushCommit1(t, repo)
    testPushCommit2(t, repo)
    testPushTag(t, repo)
    testPushTagAgain(t, repo)
    testDeleteTag(t, repo)
  })
}

function testPushCommit0(t, repo) {
  t.test('push initial commit with a file', function (t) {
    testUpdate(t, repo, 0, function () {
      testRefs(t, repo, {
        'refs/heads/master': '9a385c1d6b48b7f472ac507a3ec08263358e9804'
      })
      t.end()
    })
  })
}

function testPushCommit1(t, repo) {
  t.test('push a commit updating some files', function (t) {
    testUpdate(t, repo, 1, function () {
      testRefs(t, repo, {
        'refs/heads/master': '4afea1721eed6ab0de651f73f767c64406aeaeae'
      })
      t.end()
    })
  })
}

function testPushCommit2(t, repo) {
  t.test('push another commit and stuff', function (t) {
    testUpdate(t, repo, 2, function () {
      testRefs(t, repo, {
        'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5'
      })
      t.end()
    })
  })
}

function testPushTag(t, repo) {
  t.test('push a tag', function (t) {
    testUpdate(t, repo, 3, function () {
      testRefs(t, repo, {
        'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5',
        'refs/tags/v1.0.0': '6a63b117b09c5c82cb1085cbf525da8f94f5bdf8'
      })
      t.end()
    })
  })
}

function testPushTagAgain(t, repo) {
  t.test('push tag again', function (t) {
    var update = getUpdate(3)
    repo.update(update.refs, update.objects, function (err) {
      t.ok(err, 'pushing tag again fails')
      testRefs(t, repo, {
        'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5',
        'refs/tags/v1.0.0': '6a63b117b09c5c82cb1085cbf525da8f94f5bdf8'
      }, 'refs unchanged', 'refs unchanged')
      t.end()
    })
  })
}

function testDeleteTag(t, repo) {
  t.test('delete tag', function (t) {
    var update = getUpdate(3)
    repo.update(pull.once({
      name: 'refs/tags/v1.0.0',
      old: '6a63b117b09c5c82cb1085cbf525da8f94f5bdf8',
      new: null
    }), null, function (err) {
      t.error(err, 'deleted tag')
      testRefs(t, repo, {
        'refs/heads/master': '20a13010852a58a413d482dcbd096e4ee24657e5',
      }, 'check refs', 'tag was deleted')
      t.end()
    })
  })
}

function testUpdate(t, repo, i, onEnd) {
  var hashes = testRepoData.updates[i].objects

  // check objects non-presence
  var done = multicb({pluck: 1})
  hashes.forEach(function (hash) {
    repo.hasObject(hash, done())
  })
  done(function (err, haves) {
    t.notOk(haves.some(Boolean), 'objects not present before push')
    t.equals(haves.length, hashes.length, 'not any of the objects')

    // check objects non-existence
    var done = multicb({pluck: 1})
    hashes.forEach(function (hash) {
      repo.getObject(hash, done())
    })
    done(function (err, objects) {
      t.notOk(haves.some(Boolean), 'objects not present before push')
      t.equals(haves.length, hashes.length, 'not any of the objects')

      // push objects and ref updates
      var update = getUpdate(i)
      repo.update(update.refs, update.objects, function (err) {
        t.error(err, 'pushed update')
        t.test('objects are added', testObjectsAdded)
      })
    })
  })

  function testObjectsAdded(t) {
    var done = multicb({pluck: 1})
    hashes.forEach(function (hash) {
      repo.hasObject(hash, done())
    })
    done(function (err, haves) {
      t.ok(haves.every(Boolean), 'got the objects')
      t.equals(haves.length, hashes.length, 'all the objects')

      t.test('object contents can be retrieved', testObjectsRetrievable)
    })
  }

  function testObjectsRetrievable(t) {
    var done = multicb({pluck: 1})
    hashes.forEach(function (hash) {
      var cb = done()
      repo.getObject(hash, function (err, obj) {
        t.error(err, 'got object')
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
    done(onEnd)
  }
}

function testRefs(t, repo, refsExpected, msg, equalsMsg) {
  t.test(msg || 'refs are updated', function (t) {
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
