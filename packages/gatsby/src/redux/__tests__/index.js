const _ = require(`lodash`)
const path = require(`path`)

const writeToCache = jest.spyOn(require(`../persist`), `writeToCache`)
const { saveState, store, readState } = require(`../index`)

const {
  actions: { createPage },
} = require(`../actions`)

const mockWrittenContent = new Map()
jest.mock(`fs-extra`, () => {
  return {
    writeFileSync: jest.fn((file, content) => {
      global.console.log(
        `writeFileSync(` + file + `, ` + content.length + ` bytes)`
      )
      let r = mockWrittenContent.set(file, content)
      global.console.log(
        ` afterwards -> ` +
          mockWrittenContent.has(file) +
          ` (` +
          mockWrittenContent.get(file)?.length +
          ` bytes)`
      )
      return r
    }),
    readFileSync: jest.fn(file => {
      global.console.log(
        `readFileSync(` +
          file +
          `) -> ` +
          mockWrittenContent.has(file) +
          ` (` +
          mockWrittenContent.get(file)?.length +
          ` bytes)`
      )
      global.console.log(mockWrittenContent.get(file))
      return mockWrittenContent.get(file)
    }),
    renameSync: jest.fn((from, to) => {
      global.console.log(`renameSync(` + from + `, ` + to + `)`)
      if (mockWrittenContent.has(to)) {
        throw new Error(`File/folder exists`)
      }

      // Move all files in this folder as well ... :/
      mockWrittenContent.forEach((value, key) => {
        if (key.startsWith(from)) {
          // rename('foo/bar', 'a/b/c') => foo/bar/ding.js -> a/b/c/ding.js
          // (.replace with string arg will only replace the first occurrence)
          global.console.log(`  - renaming`, key, `to`, key.replace(from, to))
          mockWrittenContent.set(
            key.replace(from, to),
            mockWrittenContent.get(key)
          )
          mockWrittenContent.delete(key)

          global.console.log(
            ` -> ` +
              mockWrittenContent.has(key.replace(from, to)) +
              ` (` +
              mockWrittenContent.get(key.replace(from, to))?.length +
              ` bytes)`
          )
        }
      })
    }),
    existsSync: jest.fn(target => {
      global.console.log(
        `existsSync(` +
          target +
          `) -> ` +
          mockWrittenContent.has(target) +
          ` (` +
          mockWrittenContent.get(target)?.length +
          ` bytes)`
      )
      return mockWrittenContent.has(target)
    }),
    mkdtempSync: jest.fn(suffix => {
      let d = `some/tmp` + suffix + Math.random()
      global.console.log(`mkdtempSync(` + suffix + `) -> ` + d)
      mockWrittenContent.set(d, Buffer(`empty dir`))
      return d
    }),
  }
})

describe(`redux db`, () => {
  const initialComponentsState = _.cloneDeep(store.getState().components)

  beforeEach(() => {
    store.dispatch(
      createPage(
        {
          path: `/my-sweet-new-page/`,
          // seems like jest serializer doesn't play nice with Maps on Windows
          component: `/Users/username/dev/site/src/templates/my-sweet-new-page.js`,
          // The context is passed as props to the component as well
          // as into the component's GraphQL query.
          context: {
            id: `123456`,
          },
        },
        { name: `default-site-plugin` }
      )
    )

    writeToCache.mockClear()
    mockWrittenContent.clear()
  })

  it(`should write cache to disk`, async () => {
    expect(initialComponentsState).toEqual(new Map())

    await saveState()

    expect(writeToCache).toBeCalled()

    // reset state in memory
    store.dispatch({
      type: `DELETE_CACHE`,
    })
    // make sure store in memory is empty
    expect(store.getState().components).toEqual(initialComponentsState)

    // read data that was previously cached
    const data = readState()

    // make sure data was read and is not the same as our clean redux state
    expect(data.components).not.toEqual(initialComponentsState)

    // yuck - loki and redux will have different shape of redux state (nodes and nodesByType)
    expect(_.omit(data, [`nodes`, `nodesByType`])).toMatchSnapshot()
  })

  it(`should drop legacy file if exists`, async () => {
    expect(initialComponentsState).toEqual(new Map())

    const legacyLocation = path.join(process.cwd(), `.cache/redux.state`)
    mockWrittenContent.set(
      legacyLocation,
      Buffer.from(`legacy location for cache`)
    )

    await saveState()

    expect(mockWrittenContent.has(legacyLocation)).toBe(false)
  })
})
