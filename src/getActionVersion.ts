// Local imports
import { getPackageJSON } from './getPackageJSON'

export async function getActionVersion() {
	const packageJSON = await getPackageJSON()

	return packageJSON.version
}
