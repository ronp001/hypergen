import { AbsPath } from "@ronp001/ts-utils"
import { Templatizer, TemplateInfo } from './templatizer'
import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'

const APP_VERSION = "0.2.0"

export class HygenCreateError extends Error {
    constructor(public msg: string) { super(msg) }
    public get message() { return "hygen-create - " + this.msg }
}

export namespace HygenCreateError {
    export class NoSessionInProgress extends HygenCreateError { constructor() { super("no hygen-create session definitions file found ('hygen-create start' to create one)") } }
    export class FromNameNotDefined extends HygenCreateError { constructor() { super("'name word' not specified (run 'hygen-create usename' to set)") } }
    export class CantParseSessionFile extends HygenCreateError { constructor(file: string | null) { super(`can't parse session file - ${file}`) } }
    export class SessionInProgress extends HygenCreateError { constructor() { super("hygen-create session already in progress") } }
    export class NothingToGenerate extends HygenCreateError { constructor() { super("nothing to generate") } }
    export class NoFilesAdded extends HygenCreateError { constructor() { super("no files added") } }
    export class TargetPathNotSet extends HygenCreateError { constructor(reason: string) { super(`no target path for generator: ${reason}`) } }
    export class NoSuchPath extends HygenCreateError { constructor(file: string | null) { super(`can't find path ${file}`) } }
    export class FileNotFound extends HygenCreateError { constructor(file: string | null) { super(`file not found: ${file}`) } }
    export class InvalidSessionFile extends HygenCreateError { constructor(file: string | null) { super(`invalid session file -- [${file}]`) } }
    export class InvalidSessionFileVersion extends HygenCreateError { constructor(file: string | null, version: number) { super(`session file version too high (${version}) -- ${file}: consider upgrading hygen-create`) } }
    export class TryingToStartSessionWithoutPath extends HygenCreateError { constructor() { super(`session can only be started after valid path is set`) } }
    export class AddedFileMustBeUnderBaseDir extends HygenCreateError { constructor(file: string, basedir: string) { super(`cannot add ${file} - not under base dir (${basedir})`) } }
}

export interface FilesHash { [key: string]: boolean }

export class HygenCreateSession {
    about: string = "This is a hygen-create definitions file. The hygen-create utility creates generators that can be executed using hygen."
    hygen_create_version: string = APP_VERSION
    name: string = ""
    files_and_dirs: FilesHash = {}
    templatize_using_name: string | null = null
    gen_parent_dir: boolean = false
    extra?: any

    public static arrayToFilesHash(arr: Array<string>): FilesHash {
        let result: FilesHash = {}
        for (let f of arr) {
            result[f] = true
        }
        return result
    }
}

export interface FileInfo {
    path: AbsPath
    included: boolean
    found: boolean
    is_binary: boolean
}


export class HygenCreate {

    public session: HygenCreateSession | null = null
    public static default_session_file_name: string = "hygen-create.json"
    public session_file_name: string = HygenCreate.default_session_file_name
    private session_file_path: AbsPath = new AbsPath(null)
    private session_base_dir: AbsPath = new AbsPath(null)
    private orig_session_json: string = ""  // used to check if the state was changed and needs saving

    public loaded_session_version: Array<number> | null = null

    public get targetDirWithInfo(): { using: string, path: AbsPath } {
        let tried = [];

        for (let entry of [
            { using: "HYGEN_CREATE_TMPLS", value: process.env.HYGEN_CREATE_TMPLS },
            { using: "HYGEN_TMPLS", value: process.env.HYGEN_TMPLS },
            { using: "local dir", value: './_templates' }
        ]) {
            if (entry.value) {
                let ap = new AbsPath(entry.value)
                if (ap.isDir) {
                    let explain = tried.join(", ")
                    if (explain != "") explain = "(because " + explain + ")"
                    return { using: `using ${entry.using} ${explain}`, path: ap }
                } else if (ap.exists) {
                    tried.push(`${entry.using} (${entry.value}) exists but is not a directory`)
                } else {
                    tried.push(`${entry.using} (${entry.value}) does not exist`)
                }
            } else {
                tried.push(`${entry.using} not set`)
            }
        }
        return { using: tried.join(", "), path: new AbsPath(null) }
    }

    public get targetDirForGenerators(): AbsPath {
        return this.targetDirWithInfo.path
    }

    public get targetDirForGeneratorsReason(): string {
        return this.targetDirWithInfo.using
    }

    public get targetDirForGenerator(): AbsPath {
        if (this.session == null) return new AbsPath(null)
        if (this.session.name == "") return new AbsPath(null)
        return this.targetDirForGenerators.add(this.session.name).add('new')
    }

    public get fileCount(): number {
        if (this.session == null) return 0
        let result = 0
        for (let relpath in this.session.files_and_dirs) {
            if (this.session.files_and_dirs[relpath] && this.fileAbsPathFromRelPath(relpath).exists) {
                result++
            }
        }
        return result
    }

    /**
     * Where to find the current session file
     * 
     * @return AbsPath object pointing to the file.  If not set, AbsPath(null).
     */
    public get pathToCurrentSessionFile(): AbsPath {
        return this.session_file_path
    }

    private _debug_on = false
    public get debugOn(): boolean {
        return this._debug_on
    }
    public activateDebug() {
        this.debug = console.log
    }

    private noOutput(...args: any[]) { }

    private output: (...args: any[]) => void = console.log
    private debug: (...args: any[]) => void = this.noOutput
    // private debug : (...args:any[])=>void = this.output

    public set outputFunc(out_func: (...args: any[]) => void) {
        this.output = out_func
    }
    public get outputFunc() { return this.output }

    public set debugFunc(out_func: (...args: any[]) => void) {
        this.debug = out_func
    }

    /**
     * binds the HygenCreate instance to a specific path.
     * if a session already exists for this path (i.e., a session file exists in this directory or in one
     * of its ancestors) loads the session. the location of the session file marks the topmost directory 
     * in the interactive session.
     * 
     * @param for_path: <directory | file>
     * 
     *                  if directory: indicates where to start looking for the hygen-create session file.  
     *                  if no session file found this is where a new one should be created if necessary
     * 
     *                  if file: path to a session file
     * 
     * @returns true if existing session file loaded, false if not
     * @throws error if encountered problem trying to load the file
     */
    public setPathAndLoadSessionIfExists(for_path: string): boolean {
        this.debug("HygenCreate starting:", for_path)

        let p = new AbsPath(for_path)

        if (p.isDir) {
            let path_to_file = p.findUpwards(this.session_file_name)
            if (path_to_file.isFile) {
                p = path_to_file
            }
        }

        if (p.isFile) {
            // load the session file
            let sessionfile_contents: any = p.contentsFromJSON
            if (sessionfile_contents == null) {
                throw new HygenCreateError.CantParseSessionFile(p.abspath)
            }

            // verify the structure
            let versionstr = sessionfile_contents['hygen_create_version']
            if (!versionstr || !versionstr.split) throw new HygenCreateError.InvalidSessionFile(p.abspath)
            let version = sessionfile_contents['hygen_create_version'].split('.').map((n: string) => { return parseInt(n) })

            if (isNaN(version[0]) || isNaN(version[1]) || isNaN(version[2])) {
                if (this.debugOn) {
                    console.log("hygen_create_version", sessionfile_contents['hygen_create_version'])
                    console.log("version", version)
                    console.log("sessionfile contents", sessionfile_contents)
                }
                throw new HygenCreateError.InvalidSessionFile(p.abspath)
            }
            if (version[0] > 0 || version[1] > 2) {
                throw new HygenCreateError.InvalidSessionFileVersion(p.abspath, version)
            }
            this.loaded_session_version = version

            // convert arrays to hashes if necessary
            if (sessionfile_contents.files_and_dirs instanceof Array) {
                sessionfile_contents.files_and_dirs = HygenCreateSession.arrayToFilesHash(sessionfile_contents.files_and_dirs)
            }

            // create the session object
            this.session = Object.assign(new HygenCreateSession, sessionfile_contents)
            if (this.session == null) {
                throw new HygenCreateError.InvalidSessionFile(p.abspath)
            }

            this.orig_session_json = JSON.stringify(this.session)

            if (version[0] == 0 && version[1] == 1 && !this.session.gen_parent_dir) { // backwards compatibility
                this.session.gen_parent_dir = true
                this.output(chalk.red("Note: the session was started using hygen-create v0.1.x.  Parent dir generation is turned on for compatibility.\nUse 'hygen-create setopt --no-parent-dir' to turn off"))
            }
            this.session_file_path = p
            this.session_base_dir = p.parent
            return true
        } else if (p.isDir) {
            this.session_base_dir = p
            this.session_file_path = this.session_base_dir.add(this.session_file_name)
            return false
        } else {
            throw new HygenCreateError.NoSuchPath(p.abspath)
        }
    }

    /**
     * returns true if a session was started - either by loading one (when setPathAndLoadSessionIfExists was called)
     * or via start()
     */
    public get isSessionActive(): boolean {
        return this.session != null
    }

    /**
     * @returns true if there is an active session and it has been modified since loaded, or if it's new
     */
    public get doesSessionNeedSaving(): boolean {
        this.debug("this.session", JSON.stringify(this.session))
        this.debug("this.orig_session_json", this.orig_session_json)
        if (!this.session) return false
        return JSON.stringify(this.session) != this.orig_session_json
    }

    /** 
     * @returns true if session required saving, false otherwise
     */
    public saveSessionIfActiveAndChanged(): boolean {
        if (this.session && this.doesSessionNeedSaving) {
            this.debug("saving session")
            this.session.hygen_create_version = APP_VERSION
            this.session_file_path.saveStrSync(JSON.stringify(this.session, null, 2))
            return true
        }
        this.debug("session does not need saving")
        return false
    }

    /** 
     * start a new session
     * 
     * throws error if another session is already in progress
     */
    public startSession(name: string) {
        if (this.session != null) throw new HygenCreateError.SessionInProgress
        if (!this.session_base_dir.isDir) throw new HygenCreateError.TryingToStartSessionWithoutPath
        this.session = new HygenCreateSession
        this.session.name = name
        this.session.files_and_dirs[this.session_file_name] = true
    }

    public renameSession(name: string) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        this.session.name = name
    }

    /**
     * cancel the current session and delete the session file
     */
    public abort() {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        this.session = null
        if (this.session_file_path.isFile) {
            this.session_file_path.rmFile()
        }
    }

    public add(files_and_dirs: string[] | AbsPath[], recursive: boolean = false, in_subdir: boolean = false) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        if (this.session_base_dir == null) throw new HygenCreateError.NoSessionInProgress

        for (let file of files_and_dirs) {
            let p = AbsPath.fromStringAllowingRelative(file.toString())
            if (!p.exists) {
                throw new HygenCreateError.FileNotFound(p.toString())
            }

            let relpath = p.relativeFrom(this.session_base_dir, true)
            if (relpath == null) {
                throw new HygenCreateError.AddedFileMustBeUnderBaseDir(p.toString(), this.session_base_dir.toString())
            }
            if (p.isFile || p.isSymLink) {
                if (this.session.files_and_dirs[relpath]) {
                    this.output("already added:", relpath)
                } else {
                    if (p.isBinaryFile) {
                        this.output(chalk.red("not adding binary file: " + relpath))
                    } else {
                        this.output("adding: ", relpath)
                        this.session.files_and_dirs[relpath] = true
                        this.debug("session after add", this.session)
                    }
                }
            } else if (p.isDir) {
                if (in_subdir && !recursive) {
                    this.debug("not recursive - ignoring subdir", relpath)
                } else {
                    let contents = p.dirContents
                    if (contents == null || contents == []) {
                        this.output("not adding empty directory: ", relpath)
                    } else {
                        this.output("adding directory: ", relpath)
                        this.add(contents.map(e => e.toString()), recursive, true)
                    }
                }
            } else {
                this.output("not adding", relpath, "-- illegal file type")
            }
        }
    }

    public remove(files: string[]) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        if (this.session_base_dir == null) throw new HygenCreateError.NoSessionInProgress

        for (let file of files) {
            let p = AbsPath.fromStringAllowingRelative(file)

            let relpath = p.relativeFrom(this.session_base_dir, true)
            if (relpath == null) {
                throw new HygenCreateError.AddedFileMustBeUnderBaseDir(p.toString(), this.session_base_dir.toString())
            }
            if (this.session.files_and_dirs[relpath] == true) {
                this.output("removing from generator:", relpath)
                delete (this.session.files_and_dirs[relpath])
            } else {
                this.output("was not previously added: ", relpath)
            }
        }
    }

    /**
     * get the definition of param
     * 
     * @param param the param to query
     * @returns word that is converted into this param, or null if param is not defined
     */
    public getWordConversion(word: string): string | null {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress

        return this.session.templatize_using_name
    }

    /**
     * generate templates for all files that are included in the current session
     * 
     * @param from_name the word to replace with <%= name %> in the included files
     * @returns information about the would-be generated templates
     */
    public getTemplatesUsingName(from_name: string): Array<TemplateInfo> {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        let result = []

        for (let file in this.session.files_and_dirs) {
            if (this.session.files_and_dirs[file]) {
                result.push(this.getTemplate(file, from_name))
            }
        }
        return result
    }

    /**
     * generate a template from a single file
     * 
     * @param relpath relative path to the original file
     * @param using_name word to use for templatization of the <%= name %> variable
     */
    public getTemplate(relpath: string, using_name: string | null): TemplateInfo {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress

        if (using_name == null) {
            if (this.session.templatize_using_name == null) throw new HygenCreateError.FromNameNotDefined
            using_name = this.session.templatize_using_name
        }
        let abspath = this.fileAbsPathFromRelPath(relpath)
        let tinfo = Templatizer.process(relpath, abspath, using_name, this.session.gen_parent_dir)
        return tinfo
    }

    public get templates(): Array<TemplateInfo> {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        if (this.session.templatize_using_name == null) throw new HygenCreateError.FromNameNotDefined

        return this.getTemplatesUsingName(this.session.templatize_using_name)
    }

    public setGenParentDir(value: boolean) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        this.session.gen_parent_dir = value
    }

    public useName(name: string) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress

        if (this.session.templatize_using_name == name) {
            this.output(`already using '${name}' to templatize files`)
        } else {
            let prev = this.session.templatize_using_name
            this.session.templatize_using_name = name
            if (prev) {
                this.output(`using '${name}' as templatization word (instead of '${prev}')`)
            } else {
                this.output(`using '${name}' as templatization word`)
            }
        }
    }

    public paramInfo(param: string | null): string {
        if (param) {
            return `details for ${param}`
        } else {
            return "details for all params"
        }
    }

    public fileAbsPathFromRelPath(relpath: string): AbsPath {
        return AbsPath.fromStringAllowingRelative(relpath, this.session_base_dir.toString())
    }

    public getFileInfo(files: string[], verbose: boolean | undefined): Array<FileInfo> {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        if (this.session_base_dir == null) throw new HygenCreateError.NoSessionInProgress

        let result: Array<FileInfo> = []

        if (files instanceof Array && files.length == 0) {
            let existing_files = this.session.files_and_dirs
            for (let file in existing_files) {
                let abspath = this.fileAbsPathFromRelPath(file)
                files.push(abspath.toString())
            }
        }

        for (let file of files) {
            let p = AbsPath.fromStringAllowingRelative(file)
            let relpath_from_top = p.relativeFrom(this.session_base_dir)

            let included: boolean = false
            let found: boolean = false
            let is_binary = p.isBinaryFile

            if (relpath_from_top != null) {
                found = true
                included = this.session.files_and_dirs[relpath_from_top] == true
            }

            let fileinfo = {
                path: p,
                included: included,
                found: found,
                is_binary: is_binary
            }

            result.push(fileinfo)
        }

        return result
    }

    protected forEachGeneratedFile(fn: (rel_path: string, src_path: AbsPath, target_path: AbsPath) => boolean) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        for (let rel_path in this.session.files_and_dirs) {
            if (this.session.files_and_dirs[rel_path]) {
                let src_path = this.fileAbsPathFromRelPath(rel_path)
                if (src_path.isFile && !src_path.isBinaryFile) {
                    let target_path = this.targetDirForGenerator.add(Templatizer.template_filename(rel_path))
                    let abort = fn(rel_path, src_path, target_path)
                    if (abort) return
                }
            }
        }
    }

    protected isGeneratedSameAsExisting(): boolean {
        let found_diff = false

        // fail if the file count is not identical
        let existing_files = this.targetDirForGenerator.dirContents
        let num_existing_files = existing_files == null ? 0 : existing_files.length

        if (num_existing_files != this.fileCount) return false

        this.forEachGeneratedFile((rel_path: string, src_path: AbsPath, target_path: AbsPath) => {
            if (!target_path.isFile) {
                found_diff = true
                return true
            }

            let existing_contents = target_path.contentsBuffer.toString()
            let new_contents = this.getTemplateTextFor(rel_path)

            if (existing_contents != new_contents) {
                found_diff = true
                return true
            }

            return false
        })

        return !found_diff
    }

    public generate(compare_to_previous: boolean = true) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        if (this.fileCount == 0) throw new HygenCreateError.NothingToGenerate
        if (!this.targetDirForGenerator.isSet) throw new HygenCreateError.TargetPathNotSet(this.targetDirForGeneratorsReason)


        if (compare_to_previous && this.targetDirForGenerator.exists) {
            if (!this.isGeneratedSameAsExisting()) {
                let newname = this.targetDirForGenerator.renameToNextVer()
                this.output(chalk.red("previous version of generator renamed to", newname))
                this.generate(false)
            } else {
                this.output(chalk.red("generator unchanged - not saving"))
            }
            return
        }

        this.output("target path for new generator: ", this.targetDirForGenerators.toString())

        for (let file in this.session.files_and_dirs) {
            if (this.session.files_and_dirs[file]) {
                this.generateTemplateForFile(file)
            }
        }
    }

    public generateTemplateForFile(relpath: string, force: boolean = false) {
        if (this.session == null) throw new HygenCreateError.NoSessionInProgress
        if (!this.targetDirForGenerator.isSet) throw new HygenCreateError.TargetPathNotSet(this.targetDirForGeneratorsReason)

        let input_file = this.fileAbsPathFromRelPath(relpath)

        if (!input_file.isFile) {
            this.output(`generate ${input_file.toString()}: only regular files are currently supported`)
            return
        }

        // let output_file = this.targetDirForGenerator.add(relpath.replace('/','_') + ".ejs.t")
        let output_file = this.targetDirForGenerator.add(Templatizer.template_filename(relpath))
        if (!force && output_file.exists) {
            this.output("file exists (not overwriting):", output_file.abspath)
        } else {
            if (force) {
                this.output(chalk.red("overwriting: " + output_file.abspath))
            } else {
                this.output("generating:", output_file.abspath)
            }
            // this.output(this.getTemplateTextFor(relpath, input_file))
            output_file.saveStrSync(this.getTemplateTextFor(relpath))
        }
    }

    public getTemplateTextFor(relpath: string): string {
        let tinfo = this.getTemplate(relpath, null)

        if (tinfo.is_binary) {
            return "<binary file>"
        }

        return tinfo.header + tinfo.contentsAfterReplacements
    }
}