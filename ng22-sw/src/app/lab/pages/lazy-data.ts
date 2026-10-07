// Datos de relleno para que el chunk lazy tenga un tamaño apreciable
export const HEAVY_TABLE = Array.from({ length: 500 }, (_, i) => ({
  id: i,
  code: `EXP-${String(i).padStart(5, '0')}`,
  label: `Registro de prueba número ${i} para engordar el chunk lazy`,
}));
