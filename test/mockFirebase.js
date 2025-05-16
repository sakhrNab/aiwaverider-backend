// Mock Firebase implementation for testing
const firestoreFieldValue = {
  serverTimestamp: () => new Date(),
  increment: (value) => value,
  arrayUnion: (item) => [item],
  arrayRemove: (item) => []
};

const firestoreFieldPath = {
  documentId: () => 'id'
};

const admin = {
  firestore: () => ({
    FieldValue: firestoreFieldValue,
    FieldPath: firestoreFieldPath,
    collection: (name) => db.collection(name),
    batch: () => db.batch()
  }),
  auth: () => ({
    verifyIdToken: () => Promise.resolve({ uid: 'test-user' })
  })
};

// Mock data for frequently accessed collections
const mockData = {
  agents: {
    'agent-1': {
      name: 'Test Agent',
      description: 'A test agent for unit testing',
      category: 'Test',
      price: 9.99,
      downloadCount: 42,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  },
  posts: {
    'post-1': {
      title: 'Test Post',
      description: 'A test post for unit testing',
      category: 'Technology',
      imageUrl: 'https://example.com/test.jpg',
      imageFilename: 'posts/test123-test.jpg',
      createdBy: 'test-user-id',
      createdByUsername: 'testuser',
      likes: ['user-1', 'user-2'],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  },
  comments: {
    'comment-1': {
      postId: 'post-1',
      text: 'This is a test comment',
      createdBy: 'test-user-id',
      createdByUsername: 'testuser',
      createdAt: new Date(),
      likes: ['user-2']
    }
  },
  users: {
    'test-user-id': {
      username: 'testuser',
      email: 'test@example.com',
      role: 'user'
    }
  }
};

const db = {
  collection: (name) => ({
    doc: (id) => ({
      get: () => {
        // Handle standard IDs
        let exists = false;
        let data = {};

        if (name === 'agents' && (id === 'agent-1' || mockData.agents[id])) {
          exists = true;
          data = mockData.agents[id] || mockData.agents['agent-1'];
        } else if (name === 'posts' && (id === 'post-1' || mockData.posts[id])) {
          exists = true;
          data = mockData.posts[id] || mockData.posts['post-1'];
        } else if (name === 'comments' && (id === 'comment-1' || mockData.comments[id])) {
          exists = true;
          data = mockData.comments[id] || mockData.comments['comment-1'];
        } else if (name === 'users' && (id === 'test-user-id' || mockData.users[id])) {
          exists = true;
          data = mockData.users[id] || mockData.users['test-user-id'];
        }

        return Promise.resolve({
          exists,
          id: id,
          data: () => data,
          ref: {
            collection: () => ({
              get: () => Promise.resolve({
                forEach: (cb) => {}, 
                empty: true
              })
            })
          }
        });
      },
      update: () => Promise.resolve(true),
      set: () => Promise.resolve(true),
      delete: () => Promise.resolve(true),
      collection: () => ({
        doc: () => ({
          set: () => Promise.resolve(true)
        }),
        get: () => Promise.resolve({
          forEach: (cb) => {}, 
          empty: true
        })
      })
    }),
    where: (field, operator, value) => ({
      where: () => ({
        limit: () => ({
          get: () => Promise.resolve({
            forEach: (cb) => {},
            empty: true,
            docs: []
          })
        }),
        get: () => Promise.resolve({
          forEach: (cb) => {},
          empty: true,
          docs: []
        })
      }),
      limit: () => ({
        get: () => Promise.resolve({
          forEach: (cb) => {},
          empty: true,
          docs: []
        })
      }),
      orderBy: () => ({
        limit: () => ({
          get: () => Promise.resolve({
            forEach: (cb) => {},
            empty: true,
            docs: []
          })
        }),
        get: () => Promise.resolve({
          forEach: (cb) => {},
          empty: true,
          docs: []
        }),
        startAfter: () => ({
          limit: () => ({
            get: () => Promise.resolve({
              forEach: (cb) => {},
              empty: true,
              docs: []
            })
          })
        })
      }),
      get: () => Promise.resolve({
        forEach: (cb) => {},
        empty: true,
        docs: []
      })
    }),
    orderBy: () => ({
      limit: () => ({
        get: () => Promise.resolve({
          forEach: (cb) => {
            if (name === 'posts') {
              cb({
                id: 'post-1',
                data: () => mockData.posts['post-1']
              });
            } else if (name === 'agents') {
              cb({
                id: 'agent-1',
                data: () => mockData.agents['agent-1']
              });
            }
          },
          empty: false,
          docs: [
            {
              id: name === 'posts' ? 'post-1' : 'agent-1',
              data: () => (name === 'posts' ? mockData.posts['post-1'] : mockData.agents['agent-1'])
            }
          ]
        })
      }),
      get: () => Promise.resolve({
        forEach: (cb) => {
          if (name === 'posts') {
            cb({
              id: 'post-1',
              data: () => mockData.posts['post-1']
            });
          } else if (name === 'agents') {
            cb({
              id: 'agent-1',
              data: () => mockData.agents['agent-1']
            });
          }
        },
        empty: false,
        docs: [
          {
            id: name === 'posts' ? 'post-1' : 'agent-1',
            data: () => (name === 'posts' ? mockData.posts['post-1'] : mockData.agents['agent-1'])
          }
        ]
      }),
      startAfter: () => ({
        limit: () => ({
          get: () => Promise.resolve({
            forEach: (cb) => {},
            empty: true,
            docs: []
          })
        })
      })
    }),
    get: () => Promise.resolve({
      forEach: (cb) => {
        if (name === 'posts') {
          cb({
            id: 'post-1',
            data: () => mockData.posts['post-1']
          });
        } else if (name === 'agents') {
          cb({
            id: 'agent-1',
            data: () => mockData.agents['agent-1']
          });
        } else if (name === 'comments') {
          cb({
            id: 'comment-1',
            data: () => mockData.comments['comment-1']
          });
        }
      },
      empty: false,
      docs: [
        {
          id: name === 'posts' ? 'post-1' : (name === 'agents' ? 'agent-1' : 'comment-1'),
          data: () => {
            if (name === 'posts') return mockData.posts['post-1'];
            if (name === 'agents') return mockData.agents['agent-1'];
            if (name === 'comments') return mockData.comments['comment-1'];
            return {};
          }
        }
      ]
    }),
    add: () => Promise.resolve({ 
      id: name === 'posts' ? 'new-post-id' : (name === 'agents' ? 'new-agent-id' : 'new-comment-id'),
      get: () => Promise.resolve({
        exists: true,
        id: name === 'posts' ? 'new-post-id' : (name === 'agents' ? 'new-agent-id' : 'new-comment-id'),
        data: () => ({ 
          title: 'Newly Added Item',
          createdAt: new Date() 
        })
      })
    })
  }),
  runTransaction: (fn) => Promise.resolve(fn({ 
    get: () => Promise.resolve({
      exists: true,
      data: () => ({
        downloadCount: 42,
        likes: ['user-1']
      })
    }),
    update: () => Promise.resolve(true)
  })),
  batch: () => ({
    set: () => ({}),
    update: () => ({}),
    delete: () => ({}),
    commit: () => Promise.resolve()
  })
};

// Export the mock implementation
module.exports = { db, admin }; 