import { ShowOpenDialogMainIpc } from "./Dialog/showOpenDialog/Main";
import { ShowSaveDialogMainIpc } from "./Dialog/showSaveDialog/Main";
import { DeleteFileMainIpc } from "./FileSystem/deleteFile/Main";
import { EnsureDirectoryMainIpc } from "./FileSystem/ensureDirectory/Main";
import { ReadDirectoryMainIpc } from "./FileSystem/readDirectory/Main";
import { ReadFileMainIpc } from "./FileSystem/readFile/Main";
import { ReadFileChunkMainIpc } from "./FileSystem/readFileChunk/Main";
import { StatMainIpc } from "./FileSystem/stat/Main";
import { UnwatchFileMainIpc } from "./FileSystem/unwatchFile/Main";
import { WatchFileMainIpc } from "./FileSystem/watchFile/Main";
import { WriteFileMainIpc } from "./FileSystem/writeFile/Main";
import { GetAllDisplaysMainIpc } from "./System/getAllDisplays/Main";
import { GetAppVersionMainIpc } from "./System/getAppVersion/Main";
import { GetUserDataPathMainIpc } from "./System/getUserDataPath/Main";
import { GetWindowIdMainIpc } from "./System/getWindowId/Main";
import { QuitAppMainIpc } from "./System/quitApp/Main";
import { SetBoundsMainIpc } from "./System/setBounds/Main";
import { RenderDerivedMainIpc } from "./Render/renderDerived/Main";

export const ASYNC_MAIN_IPCS = [
	DeleteFileMainIpc,
	EnsureDirectoryMainIpc,
	ReadDirectoryMainIpc,
	ReadFileMainIpc,
	ReadFileChunkMainIpc,
	StatMainIpc,
	UnwatchFileMainIpc,
	WatchFileMainIpc,
	WriteFileMainIpc,
	ShowOpenDialogMainIpc,
	ShowSaveDialogMainIpc,
	GetAllDisplaysMainIpc,
	GetUserDataPathMainIpc,
	GetWindowIdMainIpc,
	GetAppVersionMainIpc,
	QuitAppMainIpc,
	SetBoundsMainIpc,
	RenderDerivedMainIpc,
];
