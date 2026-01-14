// Module imports
import '@atcute/atproto'
import * as core from '@actions/core'
import {
	Client,
	ClientResponseError,
	CredentialManager,
	ok,
} from '@atcute/client'
import diff from 'microdiff'

// Local imports
import { getActionVersion } from './getActionVersion'
import { getPublishedLexicons } from './getPublishedLexicons'
import { loadLexiconFiles } from './loadLexiconFiles'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
	const actionVersion = await getActionVersion()

	core.debug(`Using birbhouse-games/publish-lexicons v${actionVersion}`)

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
			core.info(`- ${publishedLexicon.value.id}`)
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
						core.info(`- ${lexiconDictionaryEntry.local.id} (no changes, skip)`)
					} else {
						core.info(
							`- ${lexiconDictionaryEntry.local.id} (${differences.length} changes)`,
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
		const publishErrors: Array<[Error, string]> = []

		for (const lexiconDictionaryEntry of Object.values(lexiconDictionary)) {
			if (lexiconDictionaryEntry.shouldPublish) {
				publishedLexiconIds.push(lexiconDictionaryEntry.local.id)

				try {
					await ok(
						client.post('com.atproto.repo.putRecord', {
							input: {
								repo: credentialManager.session!.did,
								collection: 'com.atproto.lexicon.schema',
								rkey: lexiconDictionaryEntry.local.id,
								record: lexiconDictionaryEntry.local as unknown as Record<
									string,
									unknown
								>,
								validate: true,
							},
						}),
					)
					core.debug(
						`Successfully published ${lexiconDictionaryEntry.local.id}`,
					)
				} catch (error) {
					core.error(`Failed to publish ${lexiconDictionaryEntry.local.id}`)
					publishErrors.push([error as Error, lexiconDictionaryEntry.local.id])
				}
			}
		}

		if (publishErrors.length) {
			publishErrors.forEach(([error]) => {
				if (error instanceof ClientResponseError) {
					core.error(`[${error.status}] ${error.error}: ${error.description}`)
				} else {
					core.error(error)
				}
			})
			core.setFailed(
				`Failed to publish ${publishErrors.length} lexicons: ${publishErrors.map(([, id]) => id).join(', ')}`,
			)
			return
		}

		core.startGroup(
			`✅ Successfully published ${publishStats.new + publishStats.updated} lexicons (${publishStats.new} new, ${publishStats.updated} updated)`,
		)
		Object.values(lexiconDictionary).forEach(({ local, shouldPublish }) => {
			if (!shouldPublish) {
				return
			}

			core.info(`- ${local.id}`)
		})
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
