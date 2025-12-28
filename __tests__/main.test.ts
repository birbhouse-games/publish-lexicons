/**
 * Unit tests for the action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mock modules before importing the module under test
jest.unstable_mockModule('@actions/core', () => core)

// Mock @atcute/client
const mockLogin = jest.fn()
const mockGet = jest.fn()
const mockPost = jest.fn()

jest.unstable_mockModule('@atcute/client', () => ({
	Client: jest.fn().mockImplementation(() => ({
		get: mockGet,
		post: mockPost,
	})),
	CredentialManager: jest.fn().mockImplementation(() => ({
		login: mockLogin,
		session: { did: 'did:plc:test123' },
	})),
	ok: jest.fn((promise) => promise),
}))

// Mock loadLexiconFiles
const mockLoadLexiconFiles = jest.fn()
jest.unstable_mockModule('../src/loadLexiconFiles.js', () => ({
	loadLexiconFiles: mockLoadLexiconFiles,
}))

// Import the module being tested
const { run } = await import('../src/main.js')

describe('main.ts', () => {
	beforeEach(() => {
		jest.clearAllMocks()

		// Default input values
		core.getInput.mockImplementation((name: string) => {
			const inputs: Record<string, string> = {
				'app-password': 'test-password-1234',
				handle: 'test.bsky.social',
				service: 'https://public.api.bsky.app',
			}
			return inputs[name] || ''
		})

		core.getMultilineInput.mockImplementation((name: string) => {
			if (name === 'lexicon-files') {
				return ['./lexicons']
			}
			return []
		})

		// Default successful responses
		mockLoadLexiconFiles.mockResolvedValue({
			'com.example.test': {
				local: { id: 'com.example.test', lexicon: 1 },
				shouldPublish: true,
			},
		})

		mockLogin.mockResolvedValue(undefined)
		mockGet.mockResolvedValue({
			records: [],
			cursor: undefined,
		})
		mockPost.mockResolvedValue({})
	})

	describe('Input Validation', () => {
		it('Throws error for empty handle', async () => {
			core.getInput.mockImplementation((name: string) => {
				if (name === 'handle') return ''
				if (name === 'app-password') return 'test-password'
				return 'default'
			})

			await run()

			expect(core.setFailed).toHaveBeenCalledWith(
				'Handle is required and cannot be empty',
			)
		})

		it('Throws error for empty password', async () => {
			core.getInput.mockImplementation((name: string) => {
				if (name === 'handle') return 'test.bsky.social'
				if (name === 'app-password') return ''
				return 'default'
			})

			await run()

			expect(core.setFailed).toHaveBeenCalledWith(
				'App password is required and cannot be empty',
			)
		})

		it('Throws error for empty lexicon files', async () => {
			core.getMultilineInput.mockReturnValue([])

			await run()

			expect(core.setFailed).toHaveBeenCalledWith(
				'At least one lexicon file path is required in lexicon-files input',
			)
		})
	})

	describe('Lexicon Loading', () => {
		it('Loads lexicon files from specified paths', async () => {
			const paths = ['./lexicons', './schemas']
			core.getMultilineInput.mockReturnValue(paths)

			await run()

			expect(mockLoadLexiconFiles).toHaveBeenCalledWith(paths)
		})

		it('Exits with warning when no lexicons found', async () => {
			mockLoadLexiconFiles.mockResolvedValue({})

			await run()

			expect(core.warning).toHaveBeenCalledWith(
				'No lexicon files found in the specified paths.',
			)
			expect(mockLogin).not.toHaveBeenCalled()
		})

		it('Logs number of loaded lexicons', async () => {
			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.one': {
					local: { id: 'com.example.one' },
					shouldPublish: true,
				},
				'com.example.two': {
					local: { id: 'com.example.two' },
					shouldPublish: true,
				},
			})

			await run()

			expect(core.info).toHaveBeenCalledWith('Loaded 2 lexicon files.')
		})
	})

	describe('Authentication', () => {
		it('Authenticates with provided credentials', async () => {
			await run()

			expect(mockLogin).toHaveBeenCalledWith({
				identifier: 'test.bsky.social',
				password: 'test-password-1234',
			})
		})

		it('Marks password as secret', async () => {
			await run()

			expect(core.setSecret).toHaveBeenCalledWith('test-password-1234')
		})

		it('Uses custom service URL when provided', async () => {
			core.getInput.mockImplementation((name: string) => {
				if (name === 'service') return 'https://custom.service.com'
				if (name === 'handle') return 'test.bsky.social'
				if (name === 'app-password') return 'test-password'
				return ''
			})

			await run()

			expect(core.info).toHaveBeenCalledWith(
				expect.stringContaining('https://custom.service.com'),
			)
		})
	})

	describe('Diff Detection', () => {
		it('Skips publishing when no differences exist', async () => {
			const lexiconData = { id: 'com.example.test', lexicon: 1 }

			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.test': {
					local: lexiconData,
					shouldPublish: true,
				},
			})

			mockGet.mockResolvedValue({
				records: [
					{
						uri: 'at://did:plc:test/com.atproto.lexicon.schema/abc123',
						cid: 'bafy123',
						value: { id: 'com.example.test', ...lexiconData },
					},
				],
				cursor: undefined,
			})

			await run()

			expect(core.info).toHaveBeenCalledWith(
				'✓ No changes detected - all lexicons are up to date',
			)
			expect(mockPost).not.toHaveBeenCalled()
		})

		it('Publishes when differences exist', async () => {
			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.test': {
					local: { id: 'com.example.test', lexicon: 1, updated: true },
					shouldPublish: true,
				},
			})

			mockGet.mockResolvedValue({
				records: [
					{
						uri: 'at://did:plc:test/com.atproto.lexicon.schema/abc123',
						cid: 'bafy123',
						value: { id: 'com.example.test', lexicon: 1, updated: false },
					},
				],
				cursor: undefined,
			})

			await run()

			expect(mockPost).toHaveBeenCalled()
			expect(core.startGroup).toHaveBeenCalledWith(
				expect.stringContaining('Successfully published'),
			)
		})
	})

	describe('Pagination', () => {
		it('Fetches all pages of published lexicons', async () => {
			mockGet
				.mockResolvedValueOnce({
					records: [
						{
							uri: 'at://did:plc:test/com.atproto.lexicon.schema/1',
							value: { id: 'com.example.one' },
						},
					],
					cursor: 'cursor1',
				})
				.mockResolvedValueOnce({
					records: [
						{
							uri: 'at://did:plc:test/com.atproto.lexicon.schema/2',
							value: { id: 'com.example.two' },
						},
					],
					cursor: undefined,
				})

			await run()

			expect(mockGet).toHaveBeenCalledTimes(2)
			expect(core.startGroup).toHaveBeenCalledWith('Found 2 published lexicons')
		})
	})

	describe('Publishing', () => {
		it('Publishes new lexicons', async () => {
			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.new': {
					local: { id: 'com.example.new', lexicon: 1 },
					shouldPublish: true,
				},
			})

			mockGet.mockResolvedValue({ records: [], cursor: undefined })

			await run()

			expect(mockPost).toHaveBeenCalledWith(
				'com.atproto.repo.applyWrites',
				expect.objectContaining({
					input: expect.objectContaining({
						repo: 'did:plc:test123',
						writes: expect.arrayContaining([
							expect.objectContaining({
								$type: 'com.atproto.repo.applyWrites#create',
								collection: 'com.atproto.lexicon.schema',
								value: expect.objectContaining({
									id: 'com.example.new',
								}),
							}),
						]),
						validate: true,
					}),
				}),
			)
		})

		it('Sets published-count output', async () => {
			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.one': {
					local: { id: 'com.example.one' },
					shouldPublish: true,
				},
				'com.example.two': {
					local: { id: 'com.example.two' },
					shouldPublish: true,
				},
			})

			await run()

			expect(core.setOutput).toHaveBeenCalledWith('published-count', 2)
		})

		it('Sets published-lexicons output with IDs', async () => {
			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.one': {
					local: { id: 'com.example.one' },
					shouldPublish: true,
				},
				'com.example.two': {
					local: { id: 'com.example.two' },
					shouldPublish: true,
				},
			})

			await run()

			expect(core.setOutput).toHaveBeenCalledWith(
				'published-lexicons',
				JSON.stringify(['com.example.one', 'com.example.two']),
			)
		})

		it('Sets breakdown stats outputs', async () => {
			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.new': {
					local: { id: 'com.example.new' },
					shouldPublish: true,
				},
				'com.example.existing': {
					local: { id: 'com.example.existing' },
					published: {
						uri: 'at://did:plc:test/com.atproto.lexicon.schema/abc123',
						cid: 'bafy123',
						value: { id: 'com.example.existing', lexicon: 1, old: true },
					},
					shouldPublish: true,
				},
				'com.example.unchanged': {
					local: { id: 'com.example.unchanged' },
					published: {
						uri: 'at://did:plc:test/com.atproto.lexicon.schema/def456',
						cid: 'bafy456',
						value: { id: 'com.example.unchanged', lexicon: 1 },
					},
					shouldPublish: false,
				},
			})

			mockGet.mockResolvedValue({ records: [], cursor: undefined })

			await run()

			expect(core.setOutput).toHaveBeenCalledWith('new-count', 1)
			expect(core.setOutput).toHaveBeenCalledWith('updated-count', 1)
			expect(core.setOutput).toHaveBeenCalledWith('skipped-count', 1)
		})

		it('Sets lexicon lists by status', async () => {
			mockLoadLexiconFiles.mockResolvedValue({
				'com.example.new': {
					local: { id: 'com.example.new' },
					shouldPublish: true,
				},
				'com.example.existing': {
					local: { id: 'com.example.existing' },
					published: {
						uri: 'at://did:plc:test/com.atproto.lexicon.schema/abc123',
						cid: 'bafy123',
						value: { id: 'com.example.existing', lexicon: 1 },
					},
					shouldPublish: true,
				},
				'com.example.unchanged': {
					local: { id: 'com.example.unchanged' },
					shouldPublish: false,
				},
			})

			mockGet.mockResolvedValue({ records: [], cursor: undefined })

			await run()

			expect(core.setOutput).toHaveBeenCalledWith(
				'new-lexicons',
				JSON.stringify(['com.example.new']),
			)
			expect(core.setOutput).toHaveBeenCalledWith(
				'updated-lexicons',
				JSON.stringify(['com.example.existing']),
			)
			expect(core.setOutput).toHaveBeenCalledWith(
				'skipped-lexicons',
				JSON.stringify(['com.example.unchanged']),
			)
		})
	})

	describe('Error Handling', () => {
		it('Catches and reports authentication errors', async () => {
			mockLogin.mockRejectedValue(new Error('Invalid credentials'))

			await run()

			expect(core.setFailed).toHaveBeenCalledWith('Invalid credentials')
		})

		it('Catches and reports API errors', async () => {
			mockGet.mockRejectedValue(new Error('Network error'))

			await run()

			expect(core.setFailed).toHaveBeenCalledWith('Network error')
		})

		it('Handles non-Error exceptions', async () => {
			mockLoadLexiconFiles.mockRejectedValue('String error')

			await run()

			expect(core.setFailed).toHaveBeenCalledWith('String error')
		})
	})
})
