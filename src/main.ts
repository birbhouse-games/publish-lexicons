// Module imports
import '@atcute/atproto'
import * as core from '@actions/core'
import { Client, CredentialManager } from '@atcute/client'
import diff from 'microdiff'
import { TID } from '@atproto/common'

// Local imports
import { getPublishedLexicons } from './getPublishedLexicons'
import { loadLexiconFiles } from './loadLexiconFiles'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
	try {
		const APP_PASSWORD = core.getInput('app-password', { required: true })
		const HANDLE = core.getInput('handle', { required: true })
		const LEXICON_FILES = core.getMultilineInput('lexicon-files', {
			required: true,
		})
		const SERVICE = core.getInput('service', { required: false })

		// Prevent app password from being leaked in logs
		core.setSecret(APP_PASSWORD)

		// Validate inputs
		if (!HANDLE || HANDLE.trim().length === 0) {
			throw new Error('Handle is required and cannot be empty')
		}

		if (!APP_PASSWORD || APP_PASSWORD.trim().length === 0) {
			throw new Error('App password is required and cannot be empty')
		}

		if (!LEXICON_FILES || LEXICON_FILES.length === 0) {
			throw new Error(
				'At least one lexicon file path is required in lexicon-files input',
			)
		}

		core.startGroup('Loading lexicon files...')

		const lexiconDictionary = await loadLexiconFiles(LEXICON_FILES)

		if (Object.keys(lexiconDictionary).length) {
			core.info(
				`Loaded ${Object.keys(lexiconDictionary).length} lexicon files.`,
			)
			core.endGroup()
		} else {
			core.warning('No lexicon files found in the specified paths.')
			core.endGroup()
			return
		}

		const credentialManager = new CredentialManager({ service: SERVICE })
		const client = new Client({ handler: credentialManager })

		core.info(`Authenticating with as ${HANDLE} via ${SERVICE}...`)

		await credentialManager.login({
			identifier: HANDLE,
			password: APP_PASSWORD,
		})

		core.info('✓ Authentication successful')

		core.info('Retrieving published lexicons from repository...')

		// Fetch all published lexicons with pagination support
		const publishedLexicons = []
		let cursor: string | undefined

		do {
			const response = await getPublishedLexicons(
				client,
				credentialManager,
				cursor,
			)

			publishedLexicons.push(...response.records)
			cursor = response.cursor
		} while (cursor)

		core.startGroup(`Found ${publishedLexicons.length} published lexicons`)
		publishedLexicons.forEach((publishedLexicon) => {
			core.debug(`- ${publishedLexicon.value.id}`)
		})
		core.endGroup()

		if (publishedLexicons.length) {
			publishedLexicons.forEach((publishedLexicon) => {
				const lexiconDictionaryEntry =
					lexiconDictionary[publishedLexicon.value.id as string]

				if (lexiconDictionaryEntry) {
					lexiconDictionaryEntry.published = publishedLexicon
				}
			})

			core.startGroup('Comparing local lexicons with published versions...')

			for (const lexiconDictionaryEntry of Object.values(lexiconDictionary)) {
				if (lexiconDictionaryEntry.published) {
					const differences = diff(
						lexiconDictionaryEntry.published.value,
						lexiconDictionaryEntry.local,
						{
							cyclesFix: false,
						},
					)

					// If no differences exist, don't publish
					if (!differences.length) {
						lexiconDictionaryEntry.shouldPublish = false
						core.info(
							`- Skipping ${lexiconDictionaryEntry.local.id} (no changes)`,
						)
					} else {
						core.info(
							`- Will update ${lexiconDictionaryEntry.local.id} (${differences.length} changes)`,
						)
					}
				}
			}

			core.endGroup()
		}

		const publishStats = {
			new: 0,
			updated: 0,
			skipped: 0,
		}

		const newLexiconIds: string[] = []
		const updatedLexiconIds: string[] = []
		const skippedLexiconIds: string[] = []

		Object.values(lexiconDictionary).forEach(
			({ local, published, shouldPublish }) => {
				if (!shouldPublish) {
					publishStats.skipped += 1
					skippedLexiconIds.push(local.id)
					return
				}

				if (published) {
					publishStats.updated += 1
					updatedLexiconIds.push(local.id)
					return
				}

				publishStats.new += 1
				newLexiconIds.push(local.id)
			},
		)

		if (publishStats.new === 0 && publishStats.updated === 0) {
			core.info('✓ No changes detected - all lexicons are up to date')
			return
		}

		core.info(
			`Publishing ${publishStats.new + publishStats.updated} lexicons (${publishStats.new} new, ${publishStats.updated} updated)...`,
		)

		const publishedLexiconIds: string[] = []
		const writes = Object.values(lexiconDictionary).reduce<
			Array<{
				$type: 'com.atproto.repo.applyWrites#create'
				collection: `${string}.${string}.${string}`
				rkey: string
				value: Record<string, unknown>
			}>
		>((accumulator, lexiconDictionaryEntry) => {
			if (lexiconDictionaryEntry.shouldPublish) {
				publishedLexiconIds.push(lexiconDictionaryEntry.local.id)
				accumulator.push({
					$type: 'com.atproto.repo.applyWrites#create',
					collection: 'com.atproto.lexicon.schema',
					rkey: lexiconDictionaryEntry.published?.uri
						? lexiconDictionaryEntry.published.uri.split('/').at(-1)!
						: TID.nextStr(),
					value: lexiconDictionaryEntry.local as unknown as Record<
						string,
						unknown
					>,
				})
			}

			return accumulator
		}, [])

		await client.post('com.atproto.repo.applyWrites', {
			input: {
				repo: credentialManager.session!.did,
				writes,
				validate: true,
			},
		})

		core.startGroup(
			`✅ Successfully published ${publishStats.new + publishStats.updated} lexicons (${publishStats.new} new, ${publishStats.updated} updated)`,
		)
		Object.values(lexiconDictionary).forEach(
			({ local, published, shouldPublish }) => {
				if (!shouldPublish) {
					return
				}

				core.info(
					`- ${local.id}${published ? `(rkey: ${published.uri.split('/').at(-1)!})` : ''}`,
				)
			},
		)
		core.endGroup()

		// Set outputs for other workflow steps
		core.setOutput('published-count', publishStats.new + publishStats.updated)
		core.setOutput('new-count', publishStats.new)
		core.setOutput('updated-count', publishStats.updated)
		core.setOutput('skipped-count', publishStats.skipped)
		core.setOutput('published-lexicons', JSON.stringify(publishedLexiconIds))
		core.setOutput('new-lexicons', JSON.stringify(newLexiconIds))
		core.setOutput('updated-lexicons', JSON.stringify(updatedLexiconIds))
		core.setOutput('skipped-lexicons', JSON.stringify(skippedLexiconIds))
	} catch (error) {
		// Fail the workflow run if an error occurs
		if (error instanceof Error) {
			core.setFailed(error.message)
		} else {
			core.setFailed(String(error))
		}
	}
}
