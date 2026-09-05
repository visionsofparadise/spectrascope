export type RequiredProperties<D extends object, K extends keyof D> = Pick<D, K> & Partial<Omit<D, K>>;
