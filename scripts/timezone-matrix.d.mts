type MatrixRows = readonly unknown[];
type Reporter = (message: string) => void;

interface MatrixOptions {
	tables?: Record<string, MatrixRows>;
	dstScenarios?: Record<string, MatrixRows>;
	log?: Reporter;
	error?: Reporter;
}

export function runMatrix(tz: string, options?: MatrixOptions): number;
