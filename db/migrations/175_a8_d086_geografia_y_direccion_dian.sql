-- =============================================================================
-- 175_a8_d086_geografia_y_direccion_dian.sql — D-086
--
-- PARTE A. Catálogo geográfico relacional. `municipality` ya existía (004) como
-- tabla plana con `departamento` / `codigo_dane_departamento` de texto. Esta
-- migración añade la tabla `department` (identidad DANE, sin vigencia, igual
-- criterio que `municipality`), la SIEMBRA con los 33 departamentos (33 filas
-- de identidad pura: código de 2 dígitos + nombre, cero valores tributarios —
-- se ponen aquí, y no en un seed, para poder reenlazar en la misma transacción
-- los pocos municipios globales que un seed anterior ya hubiera cargado), y
-- una FK `municipality.department_id`. NO se rompe nada de lo construido: la
-- columna es NULLABLE y un trigger la resuelve desde `codigo_dane_departamento`,
-- así que cada INSERT antiguo (fixtures de prueba, seeds 080/040) sigue
-- funcionando sin tocarse. Los 1.122 MUNICIPIOS van en
-- `db/seeds/tanda0-geografia/020_municipios.sql` (sembrarlos aquí rompería las
-- pruebas de A1 que cuentan `municipality` tras la tanda 1).
--
-- PARTE B. Dirección en formato DIAN (Formato 1001 de exógena). `third_party`
-- gana `direccion_dian jsonb` con el desglose campo a campo; cuando no es NULL,
-- `third_party.direccion` (la cadena que consume exógena) es su composición
-- exacta. Los terceros creados antes de D-086 conservan su `direccion` de
-- texto libre y quedan marcados `direccion_requiere_revision` (backfill al
-- final de esta migración). Nada se borra ni se adivina.
--
-- Regla de Oro 2: aquí no hay ni una tarifa, base, UVT, tope ni calendario. Los
-- códigos DANE y las abreviaturas de nomenclatura DIAN son identificadores
-- públicos y estables, no valores tributarios.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PARTE A — department
-- ---------------------------------------------------------------------------
CREATE TABLE department (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid REFERENCES tenant(id),    -- NULL = catálogo global
  company_id        uuid REFERENCES company(id),
  codigo_dane_dpto  text NOT NULL,
  nombre            text NOT NULL,
  activo            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT department_dane_uq UNIQUE NULLS NOT DISTINCT (tenant_id, codigo_dane_dpto),
  CONSTRAINT department_dane_ck CHECK (codigo_dane_dpto ~ '^[0-9]{2}$'),
  CONSTRAINT department_alcance_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL)
);

COMMENT ON TABLE  department IS 'D-086: catálogo DANE de departamentos (DIVIPOLA). Identidad estable, sin vigencia — mismo criterio que municipality.';
COMMENT ON COLUMN department.codigo_dane_dpto IS 'Código DANE de 2 dígitos del departamento (prefijo del código de 5 de sus municipios).';

SELECT app.instalar_rls_hibrida('department');
SELECT app.instalar_permiso_escritura('department', 'parametro.editar');
CREATE TRIGGER department_updated_at BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION app.trg_set_updated_at();
-- Guardia de alcance de su FK a company (D-032 / 018), igual que municipality.
SELECT app.instalar_guardia_alcance('department', 'company_id', 'company');

-- Los 33 departamentos DANE (DIVIPOLA, portal oficial datos.gov.co, dataset
-- vcjz-niiq; verificado 2026-09-02). Incluye Bogotá, D.C. como entidad propia.
INSERT INTO department (tenant_id, company_id, codigo_dane_dpto, nombre)
SELECT NULL, NULL, v.cod, v.nom
FROM (VALUES
  ('05', 'Antioquia'),
  ('08', 'Atlántico'),
  ('11', 'Bogotá, D.C.'),
  ('13', 'Bolívar'),
  ('15', 'Boyacá'),
  ('17', 'Caldas'),
  ('18', 'Caquetá'),
  ('19', 'Cauca'),
  ('20', 'Cesar'),
  ('23', 'Córdoba'),
  ('25', 'Cundinamarca'),
  ('27', 'Chocó'),
  ('41', 'Huila'),
  ('44', 'La Guajira'),
  ('47', 'Magdalena'),
  ('50', 'Meta'),
  ('52', 'Nariño'),
  ('54', 'Norte de Santander'),
  ('63', 'Quindío'),
  ('66', 'Risaralda'),
  ('68', 'Santander'),
  ('70', 'Sucre'),
  ('73', 'Tolima'),
  ('76', 'Valle del Cauca'),
  ('81', 'Arauca'),
  ('85', 'Casanare'),
  ('86', 'Putumayo'),
  ('88', 'Archipiélago de San Andrés, Providencia y Santa Catalina'),
  ('91', 'Amazonas'),
  ('94', 'Guainía'),
  ('95', 'Guaviare'),
  ('97', 'Vaupés'),
  ('99', 'Vichada')
) AS v(cod, nom)
WHERE NOT EXISTS (SELECT 1 FROM department e WHERE e.tenant_id IS NULL AND e.codigo_dane_dpto = v.cod);

-- ---------------------------------------------------------------------------
-- PARTE A — municipality.department_id (nullable + trigger de resolución)
-- ---------------------------------------------------------------------------
ALTER TABLE municipality ADD COLUMN department_id uuid REFERENCES department(id);
CREATE INDEX municipality_department_idx ON municipality (department_id);

COMMENT ON COLUMN municipality.department_id IS
  'D-086: FK al catálogo relacional department. La resuelve el trigger municipality_resolver_departamento desde codigo_dane_departamento; las columnas de texto departamento / codigo_dane_departamento se conservan por compatibilidad con los consumidores previos (exógena, selectores).';

CREATE OR REPLACE FUNCTION app.trg_municipality_resolver_departamento() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app, public
  AS $$
BEGIN
  IF NEW.department_id IS NULL AND NEW.codigo_dane_departamento IS NOT NULL THEN
    SELECT d.id INTO NEW.department_id
      FROM public.department d
     WHERE d.codigo_dane_dpto = NEW.codigo_dane_departamento
       AND (d.tenant_id IS NULL OR d.tenant_id = NEW.tenant_id)
     ORDER BY (d.tenant_id IS NOT NULL) DESC
     LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.trg_municipality_resolver_departamento() IS
  'D-086: rellena municipality.department_id desde codigo_dane_departamento si viene NULL, en el propio INSERT/UPDATE.';

-- Orden alfabético de triggers BEFORE de fila: municipality_permiso (016) <
-- municipality_resolver_departamento < municipality_updated_at (004). Correcto:
-- primero el permiso, luego la resolución.
CREATE TRIGGER municipality_resolver_departamento
  BEFORE INSERT OR UPDATE ON municipality
  FOR EACH ROW EXECUTE FUNCTION app.trg_municipality_resolver_departamento();

-- Guardia de alcance de la FK nueva (D-032 / migración 018): department es un
-- catálogo híbrido (tenant_id puede ser NULL), así que la FK compuesta no es
-- expresable y va el trigger genérico `trg_fk_alcance`. `municipality` ya tenía
-- su trigger `municipality_fk_alcance` (guardaba company_id) — se recrea con el
-- par nuevo añadido.
DROP TRIGGER municipality_fk_alcance ON municipality;
SELECT app.instalar_guardia_alcance('municipality', 'company_id', 'company', 'department_id', 'department');

DROP TRIGGER third_party_fk_alcance ON third_party;
SELECT app.instalar_guardia_alcance('third_party', 'municipality_id', 'municipality', 'department_id', 'department');

-- Reenlaza los municipios globales que un seed anterior (080/040) ya hubiera
-- cargado con department_id NULL. En una base nueva la tabla municipality está
-- vacía y esto no toca ninguna fila; el catálogo completo lo siembra
-- db/seeds/tanda0-geografia y el trigger lo enlaza en cada INSERT.
UPDATE municipality m
   SET department_id = d.id
  FROM department d
 WHERE m.department_id IS NULL
   AND m.codigo_dane_departamento IS NOT NULL
   AND d.codigo_dane_dpto = m.codigo_dane_departamento
   AND (d.tenant_id IS NULL OR d.tenant_id = m.tenant_id);

-- ---------------------------------------------------------------------------
-- PARTE B — dirección en formato DIAN sobre third_party
-- ---------------------------------------------------------------------------
ALTER TABLE third_party
  ADD COLUMN department_id                uuid REFERENCES department(id),
  ADD COLUMN direccion_dian               jsonb,
  ADD COLUMN direccion_requiere_revision  boolean NOT NULL DEFAULT false,
  ADD COLUMN municipio_requiere_revision  boolean NOT NULL DEFAULT false;

CREATE INDEX third_party_department_idx ON third_party (department_id);

COMMENT ON COLUMN third_party.direccion_dian IS
  'D-086: desglose campo a campo de la dirección en formato DIAN (Formato 1001). Cuando NO es NULL, third_party.direccion es exactamente su composición. NULL = dirección heredada en texto libre, aún sin normalizar.';
COMMENT ON COLUMN third_party.direccion_requiere_revision IS
  'D-086: la dirección viene de antes del selector DIAN y no se pudo desglosar con confianza. Visible y corregible; nunca se descarta el texto original.';
COMMENT ON COLUMN third_party.municipio_requiere_revision IS
  'D-086: el municipio del tercero no se pudo mapear al catálogo DANE con confianza. Se marca para corrección manual, no se borra ni se adivina.';
COMMENT ON COLUMN third_party.department_id IS
  'D-086: departamento del tercero, denormalizado desde municipality para el selector dependiente departamento -> municipio.';

-- ---------------------------------------------------------------------------
-- PARTE B — migración de datos de los terceros creados antes de D-086.
--
-- Criterio idéntico para municipio y dirección: se rellena lo resoluble por
-- clave y se MARCA el resto para corrección manual — nunca se borra el dato
-- viejo ni se inventa uno. En una base nueva no hay terceros y esto no toca
-- ninguna fila.
-- ---------------------------------------------------------------------------

-- department_id del tercero, denormalizado desde su municipio (para el selector
-- dependiente de la ficha). Si el municipio aún no tiene department_id, el
-- SELECT de la ficha cae a m.department_id vía COALESCE, así que esto es solo
-- una conveniencia, no un requisito.
UPDATE third_party tp
   SET department_id = mu.department_id
  FROM municipality mu
 WHERE tp.municipality_id = mu.id
   AND mu.department_id IS NOT NULL
   AND tp.department_id IS NULL;

-- Municipio ausente en un tercero nacional -> marcar (no se puede mapear).
UPDATE third_party
   SET municipio_requiere_revision = true
 WHERE es_del_exterior = false
   AND municipality_id IS NULL;

-- Dirección heredada en texto libre (sin desglose DIAN) -> marcar para que el
-- contador la recomponga con el selector. El texto original queda intacto.
--
-- A14 (compuerta ampliada de D-086): la condición original exigía además
-- `direccion IS NOT NULL AND btrim(direccion) <> ''`, y por eso dejaba SIN
-- marcar justo el caso peor: el tercero nacional que no tiene NINGUNA
-- dirección (los creados antes de que D-084 la hiciera obligatoria). Ese
-- tercero rompe el Formato 1001 y era el único que no se veía en ninguna
-- parte. Un tercero nacional sin desglose DIAN se marca, tenga texto o no.
UPDATE third_party
   SET direccion_requiere_revision = true
 WHERE es_del_exterior = false
   AND direccion_dian IS NULL
   AND direccion_requiere_revision = false;
