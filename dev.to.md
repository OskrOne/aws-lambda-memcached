# AWS Lambda + ElastiCache Multi AZ en una red privada con acceso a internet

Hoy en día, las aplicaciones que tienen un contacto directo con el usuario, por ejemplo una aplicación web o una aplicación movil requieren una latencia muy baja y un rendimiento muy alto, un usuario puede perder el interés si una aplicación tarda 2 o 3 segundos en responder.

Ejecutar una consulta en una base de datos con múltiples joins o consultar una API externa puede ser costoso, es entonces cuando es muy beneficioso usar caché, para responder de manera óptima al cliente.

Este es un ejemplo de como usar AWS ElastiCache a través de una Lambda en una red privada

## Caso de uso

El caso de uso se compone de las siguientes características

* Cluster de memcached en una red privada
* Multi AZ deployment para garantizar alta disponilidad y tolerancia a fallos
* Ejemplo de una lambda que guarda y recupera datos del cluster de memcached
* La lambda con acceso a Internet para consultar una API externa

## Componentes de AWS

Antes de comenzar con la solución es importante mencionar todos los servicios de AWS que se usarán en conjunto

* [VPC](https://aws.amazon.com/vpc): Red privada en AWS compuesta por 2 subnets privadas y 2 subnets públicas
* [Internet Gateway](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html): Gateway redundante y de alta dispobilidad que permite la comunicación entre Internet y la VPC
* [NAT Gateway](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html): Gateway que permite a subnets privadas conectarse a Internet, pero no permite que desde Internet se alcance la red privada.
* [ElastiCache](https://docs.aws.amazon.com/elasticache/index.html): Almacenamiento en memoria, para este caso usaremos el motor de memcached
* [Lambda](https://aws.amazon.com/lambda/getting-started/): Cómputo sin servidor ejecutándose en una red privada para poder acceder al cluster de memcached

En conjunto se ve así:
![Alt Text](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/ol1f9g4x7nem4de8namj.png)

Aquí unos detalles importantes a mencionar

* Se tienen dos subnets privadas y dos subnets públicas, dos de cada una por que una subnet no puede pertenecer a más de un availability zone y para garantizar la alta disponibilidad se necesitan al menos dos AZ
* Solo se tiene una Internet Gataway por que por default, AWS garantiza la alta disponiblidad de este servicio
* Se tiene una NAT Gateway por cada AZ por que este servicio solo tiene alta disponiblidad dentro de la AZ, si solo tuvieramos una NAT Gateway y hubiera algún problema con esa AZ, perderíamos totalmente acceso a Internet, en cambio como se tienen dos, se garantiza la alta disponibilidad de toda la solución
* La definición del cluster de memcached es MultiAZ con dos nodos, de esta manera se garantiza la alta disponiblidad

## Implementación

Todos los recursos los podemos definir a través de [Cloud Formation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html) y para poder hacer deployment, para facilitar el ejemplo, podemos usar Serverless Framework

Todo el código está en [GitHub](https://github.com/OskrOne/aws-lambda-memcached), aquí algunos fragmentos que ayudan a explicar el ejemplo

La primera dependencia de un cluster de elasticache es un subnet group en donde se definen las subnets que se usarán, en este caso, para garantizar la seguridad, se usan las subnets privadas
```yaml
  MemcachedSubnetGroup:
    Type: AWS::ElastiCache::SubnetGroup
    Properties:
      CacheSubnetGroupName: MemcachedSubnetGroup
      Description: Memcached subnet group
      SubnetIds:
        - Ref: PrivateSubnetA
        - Ref: PrivateSubnetB
```

La segunda dependencia de un cluster de elasticache es el security group que usará el cluster, como buena práctica debemos permitir únicamente acceso al cluster desde las ips privadas de la subnet. Es decir, solamente un recurso dentro de la red privada podrá acceder al cluster, en este caso, las instancias de las lambdas
```yaml
  SecurityGroupMemcached:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security Group Memcached
      GroupName: SecurityGroupMemcached
      VpcId:
        Ref: VPC
      SecurityGroupIngress:
      - IpProtocol: tcp
        FromPort: 11211
        ToPort: 11211
        CidrIp: 10.0.0.128/26
        Description: Private subnet A
      - IpProtocol: tcp
        FromPort: 11211
        ToPort: 11211
        CidrIp: 10.0.0.192/26
        Description: Private subnet B
```

Finalmente, la definición del cluster
```yaml
  Memcached:
    Type: AWS::ElastiCache::CacheCluster
    Properties:
      AZMode: cross-az
      CacheNodeType: cache.t2.small
      CacheSubnetGroupName:
        Ref: MemcachedSubnetGroup
      ClusterName: MemcachedCluster
      Engine: memcached
      NumCacheNodes: 2
      Tags: 
        - Key: Name
          Value: MemcachedCluster
      VpcSecurityGroupIds:
        - Ref: SecurityGroupMemcached
```

Es momento de hablar de la lambda, esta lambda se debe de instanciar dentro de la VPC en las subnets privadas, para lograr esto, lo definiremos a través de [Serverlesss Framework](https://www.serverless.com/)

```yaml
functions:
  memcached:
    handler: index.handler
    vpc:
      subnetIds:
        - Ref: PrivateSubnetA
        - Ref: PrivateSubnetB
      securityGroupIds:
        - Fn::GetAtt: [ VPC, DefaultSecurityGroup ]
    environment:
      memcachedUrl: !GetAtt 'Memcached.ConfigurationEndpoint.Address'
```

La variable de ambiente memcachedUrl se usa dentro de la lambda para poder conectarse al cluster, ahora veamos el código de la lambda, se usa Javascript

```javascript
const memjs = require('memjs');
const axios = require('axios').default;

const getMemcachedURL = () => process.env.memcachedUrl;
const url = 'https://dummy.restapiexample.com/api/v1/employees';
const memcachedKey = 'employees';

module.exports.handler = async(event) => {
    const client = memjs.Client.create(getMemcachedURL());
    const employees = await client.get(memcachedKey);

    let response;
    if (employees.value !== null) {
        response = JSON.parse(employees.value.toString());
    } else { 
        const axiosResponse = await axios.get(url, {
            headers: {
                Accept: 'application/json'
            }
        });
        await client.set(memcachedKey, JSON.stringify(axiosResponse.data));
        response = axiosResponse.data;
    }
    
    client.quit();  
    return response;
};
```

Como estrategia de caching, se usa [Lazy loading](https://docs.aws.amazon.com/AmazonElastiCache/latest/mem-ug/Strategies.html), es decir, como primer paso se verifica si los datos existen en caché, si existe, se devuelve el dato, si no existe, se obtiene de la fuente y se agrega a caché. A pesar de que la lambda está dentro de una red privada, puede acceder a internet a través de la NAT Gateway!

## Despliegue

Ahora, es momento de instalar la solución en AWS, ejecutemos lo siguente

```bash
npm install
sls deploy
```

Esperemos algunos minutos debido a que la primera vez se crean todos los recursos, VPC, subnets, cluster, etc. y ahora, veamos que sucede si probamos la función

```bash
sls invoke --function memcached --log
```

La primera vez veremos una respuesta lenta, entre 0.5 y 1 segundo
```bash
START RequestId: ffba5783-0861-432a-8897-b506926a8e83 Version: $LATEST
END RequestId: ffba5783-0861-432a-8897-b506926a8e83
REPORT RequestId: ffba5783-0861-432a-8897-b506926a8e83	Duration: 690.68 ms
```

Segunda ejecución, entre 5 y 10 milisegundos! Magia
```bash
START RequestId: c37b5913-7b96-49d7-a721-88c35f164db3 Version: $LATEST
END RequestId: c37b5913-7b96-49d7-a721-88c35f164db3
REPORT RequestId: c37b5913-7b96-49d7-a721-88c35f164db3	Duration: 6.28 ms
```