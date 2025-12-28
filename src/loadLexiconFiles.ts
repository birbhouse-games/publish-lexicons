// Module imports
import * as core from '@actions/core'
import fs from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Local imports
import { type LexiconDictionary } from './typedefs/LexiconDictionary'
import { type LocalLexicon } from './typedefs/LocalLexicon'
import { type PathDetails } from './typedefs/PathDetails'

export async function loadLexiconFiles(
	paths: Array<string | PathDetails>,
	lexiconDictionary: LexiconDictionary = {},
	visitedPaths: Set<string> = new Set(),
) {
	for (const pathItem of paths) {
		const pathString = typeof pathItem === 'string' ? pathItem : pathItem.path
		const normalizedPath = resolve(pathString)

		// Skip if we've already processed this path
		if (visitedPaths.has(normalizedPath)) {
			continue
		}

		visitedPaths.add(normalizedPath)

		let stats
		try {
			stats = await fs.stat(normalizedPath)
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error)
			throw new Error(
				`Failed to access path "${normalizedPath}": ${errorMessage}\n` +
					`Ensure the path exists and is accessible.`,
			)
		}

		// Handle directories recursively
		if (stats.isDirectory()) {
			const directoryContents = await fs.readdir(normalizedPath, {
				recursive: true,
			})

			// Join parent path with child entries to create absolute paths
			const fullPaths = directoryContents.map((entry) =>
				join(normalizedPath, entry),
			)

			await loadLexiconFiles(fullPaths, lexiconDictionary, visitedPaths)
			continue
		}

		// Skip non-JSON files
		if (!normalizedPath.endsWith('.json')) {
			continue
		}

		// Process JSON file
		let lexiconFile: string
		try {
			lexiconFile = await fs.readFile(normalizedPath, 'utf8')
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error)
			throw new Error(
				`Failed to read lexicon file "${normalizedPath}": ${errorMessage}\n` +
					`Check file permissions and ensure the file is readable.`,
			)
		}

		let lexiconJSON: LocalLexicon
		try {
			lexiconJSON = JSON.parse(lexiconFile)
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error)
			throw new Error(
				`Failed to parse "${normalizedPath}" as valid JSON: ${errorMessage}\n` +
					`Ensure the file contains valid JSON syntax.`,
			)
		}

		// Validate that the lexicon has an id field
		if (!lexiconJSON.id) {
			throw new Error(
				`Lexicon file "${normalizedPath}" is missing required "id" field.\n` +
					`All ATProto lexicons must have an "id" field (e.g., "com.example.myLexicon").`,
			)
		}

		core.info(`Loaded file: ${lexiconJSON.id}`)

		lexiconDictionary[lexiconJSON.id] = {
			local: lexiconJSON,
			shouldPublish: true,
		}
	}

	return lexiconDictionary
}
