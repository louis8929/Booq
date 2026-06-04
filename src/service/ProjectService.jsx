const PROJECT_JSON = '/projects.json'

const LATENCY = 1000

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

let cache = null

export async function load() {
    if (!cache) {
        cache = (async () => {
            await delay(LATENCY)
            const res = await fetch(PROJECT_JSON)
            if (!res.ok) {
                throw new Error(`Failed to load projects (${res.status})`)
            }
            const data = await res.json()
            return data.projects ?? []
        })().catch((err) => {
            cache = null
            throw err
        })
    }
    return cache
}

export async function getProject(id) {
    const projects = await load()
    const project = projects.find((p) => p.id === id)
    if (!project) {
        throw new Error(`Project "${id}" was not found`)
    }
    return project
}

export async function addMember(member) {
    await delay(LATENCY)
    return {
        user_id: crypto.randomUUID(),
        name: member.name.trim(),
        email: member.email.trim(),
        role: member.role,
    }
}
